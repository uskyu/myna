"""
System management routes - version check, update, health
"""
import os
import asyncio
import subprocess
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.requests import Request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/system", tags=["system"])

IS_DOCKER = os.path.exists("/.dockerenv")


@router.get("/version")
async def get_version():
    """获取当前版本信息"""
    return {
        "version": "0.7.3",
        "is_docker": IS_DOCKER,
        "engine": "hermes-agent"
    }


@router.get("/check-update")
async def check_system_update():
    """检查是否有新版本（Docker 模式）"""
    if not IS_DOCKER:
        return {"has_update": False, "message": "非 Docker 部署"}
    
    try:
        # 获取本地镜像 digest
        local_result = subprocess.run(
            ["docker", "images", "--digests", "--format", "{{.Digest}}", "ghcr.io/uskyu/myna:latest"],
            capture_output=True, text=True, timeout=10
        )
        local_digest = local_result.stdout.strip()
        
        # 获取远程最新 digest
        remote_result = subprocess.run(
            ["docker", "manifest", "inspect", "ghcr.io/uskyu/myna:latest", "-v"],
            capture_output=True, text=True, timeout=15
        )
        
        if remote_result.returncode == 0:
            manifest = json.loads(remote_result.stdout)
            remote_digest = manifest[0]["Descriptor"]["digest"] if isinstance(manifest, list) else manifest["Descriptor"]["digest"]
            
            has_update = local_digest != remote_digest
            return {
                "has_update": has_update,
                "local_version": local_digest[:12] if local_digest else "unknown",
                "remote_version": remote_digest[:12] if remote_digest else "unknown"
            }
        else:
            return {"has_update": False, "error": "无法获取远程版本"}
            
    except Exception as e:
        logger.error(f"检查更新失败: {e}")
        return {"has_update": False, "error": str(e)}


@router.post("/update")
async def trigger_system_update(request: Request):
    """手动触发系统更新（Docker 模式）"""
    if not IS_DOCKER:
        raise HTTPException(400, "仅 Docker 部署支持在线更新")
    
    ws_manager = request.app.state.ws_manager
    asyncio.create_task(do_system_update(ws_manager))
    return {"success": True, "message": "更新任务已启动"}


async def do_system_update(ws_manager):
    """执行系统更新：pull 镜像 + 重启容器"""
    try:
        # 通知前端开始更新
        await ws_manager.notify_ui({
            "type": "update_progress",
            "status": "pulling",
            "progress": 0,
            "message": "开始拉取镜像..."
        })
        
        # 执行 docker pull，逐行解析进度
        process = await asyncio.create_subprocess_exec(
            "docker", "pull", "ghcr.io/uskyu/myna:latest",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        
        layers = {}
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            
            text = line.decode().strip()
            logger.info(f"[PULL] {text}")
            
            # 解析 docker pull 输出格式
            # 例如: "a1b2c3d4e5f6: Downloading [==>  ] 1.5MB/10MB"
            if ":" in text and any(kw in text for kw in ["Downloading", "Extracting", "Pull complete"]):
                parts = text.split(":", 1)
                layer_id = parts[0].strip()
                status = parts[1].strip()
                
                if "Downloading" in status or "Extracting" in status:
                    # 尝试解析进度百分比
                    if "[" in status and "]" in status:
                        bracket_content = status[status.index("[")+1:status.index("]")]
                        # 简单估算：根据 = 符号数量
                        equals = bracket_content.count("=")
                        total_width = 50  # docker 默认进度条宽度
                        progress = int((equals / total_width) * 100) if total_width > 0 else 0
                        layers[layer_id] = progress
                elif "Pull complete" in status:
                    layers[layer_id] = 100
            
            # 计算总体进度
            if layers:
                avg_progress = sum(layers.values()) / len(layers)
                await ws_manager.notify_ui({
                    "type": "update_progress",
                    "status": "pulling",
                    "progress": int(avg_progress),
                    "message": f"下载中... {int(avg_progress)}%"
                })
        
        await process.wait()
        
        if process.returncode != 0:
            await ws_manager.notify_ui({
                "type": "update_progress",
                "status": "error",
                "progress": 0,
                "message": "镜像拉取失败"
            })
            return
        
        # 镜像拉取完成
        await ws_manager.notify_ui({
            "type": "update_progress",
            "status": "restarting",
            "progress": 100,
            "message": "镜像已更新，正在重启容器..."
        })
        
        # 重启容器（通过 docker compose）
        restart_process = await asyncio.create_subprocess_exec(
            "docker", "compose", "up", "-d", "--force-recreate",
            cwd="/root/myna",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        await restart_process.wait()
        
        # 完成
        await ws_manager.notify_ui({
            "type": "update_progress",
            "status": "completed",
            "progress": 100,
            "message": "更新完成，容器已重启"
        })
        
    except Exception as e:
        logger.error(f"系统更新失败: {e}")
        await ws_manager.notify_ui({
            "type": "update_progress",
            "status": "error",
            "progress": 0,
            "message": f"更新失败: {str(e)}"
        })
