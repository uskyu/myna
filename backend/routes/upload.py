"""
File upload endpoint.
"""
import os
import time
import random
import string
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Request
from paths import UPLOADS_DIR

router = APIRouter()

UPLOAD_DIR = UPLOADS_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/admin/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    ext = Path(file.filename).suffix if file.filename else ""
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    filename = f"{int(time.time())}-{rand}{ext}"
    filepath = UPLOAD_DIR / filename

    content = await file.read()
    filepath.write_bytes(content)

    file_type = "image" if file.content_type and file.content_type.startswith("image/") else "file"
    return {
        "ok": True,
        "url": f"/uploads/{filename}",
        "type": file_type,
        "name": file.filename,
        "size": len(content)
    }
