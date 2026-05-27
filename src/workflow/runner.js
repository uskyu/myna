/**
 * WorkflowRunner Engine
 * Executes multi-step workflows in dedicated threads.
 */

const { processMessage } = require('../ai/index');

class WorkflowRunner {
  constructor(db, wsManager) {
    this.db = db;
    this.wsManager = wsManager;
    this.activeRuns = new Map(); // runId -> { cancelled: bool }
  }

  /**
   * Ensure the 'system' agent exists for workflow system messages.
   */
  _ensureSystemAgent() {
    const existing = this.db.getAgentById('system');
    if (!existing) {
      this.db.db.prepare(
        `INSERT OR IGNORE INTO agents (id, name, api_key, description, status) VALUES ('system', '系统', '__system__', '系统消息', 'online')`
      ).run();
    }
  }

  /**
   * Send a system message to a thread and notify UI via WS.
   */
  _sendSystemMessage(roomId, threadId, text) {
    this._ensureSystemAgent();
    const message = this.db.createMessageInThread(roomId, threadId, 'system', text, 'markdown');
    if (this.wsManager) {
      this.wsManager.notifyUI({
        type: 'new_message',
        room_id: roomId,
        thread_id: threadId,
        message: {
          id: message.id,
          room_id: roomId,
          sender_id: 'system',
          sender_name: '系统',
          text,
          thread_id: threadId,
          created_at: new Date().toISOString()
        }
      });
    }
    return message;
  }

  /**
   * Start a workflow run.
   * @returns {{ runId, threadId }}
   */
  async start(workflowId, roomId) {
    const workflow = this.db.getWorkflow(workflowId);
    if (!workflow) throw new Error('Workflow not found');

    const runNumber = this.db.getWorkflowRunCount(workflowId) + 1;
    const threadTitle = `流程: ${workflow.name} #${runNumber}`;

    // Create thread for this run
    const thread = this.db.createThread(roomId, threadTitle, workflowId);
    this.db.updateThread(thread.id, { status: 'workflow_running' });

    // Create workflow_run record
    const run = this.db.createWorkflowRun(workflowId, thread.id);

    // Track active run
    this.activeRuns.set(run.id, { cancelled: false });

    // Send initial system message
    this._sendSystemMessage(roomId, thread.id, `[系统] 🚀 开始执行流程「${workflow.name}」`);

    // Execute steps asynchronously
    this._executeSteps(run.id, workflow, roomId, thread.id).catch(err => {
      console.error(`[Workflow] Run ${run.id} error:`, err.message);
    });

    return { runId: run.id, threadId: thread.id };
  }

  /**
   * Execute all steps sequentially.
   */
  async _executeSteps(runId, workflow, roomId, threadId) {
    const steps = JSON.parse(workflow.steps_json);
    const totalSteps = steps.length;

    for (let i = 0; i < totalSteps; i++) {
      // Check if cancelled
      const runState = this.activeRuns.get(runId);
      if (runState && runState.cancelled) {
        this._sendSystemMessage(roomId, threadId, `[系统] ⏹ 流程已取消`);
        this.db.updateWorkflowRun(runId, { status: 'cancelled', completed_at: new Date().toISOString() });
        this.db.updateThread(threadId, { status: 'active' });
        this.activeRuns.delete(runId);
        return;
      }

      const step = steps[i];
      const stepNum = i + 1;

      try {
        await this._executeStep(runId, workflow, roomId, threadId, step, stepNum, totalSteps);
        // Update current_step
        this.db.updateWorkflowRun(runId, { current_step: stepNum });
        // Wait 1 second between steps
        if (i < totalSteps - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (err) {
        // Step failed
        this._sendSystemMessage(roomId, threadId, `[系统] ❌ 步骤失败: ${err.message}`);
        this.db.updateWorkflowRun(runId, { status: 'failed', completed_at: new Date().toISOString() });
        this.db.updateThread(threadId, { status: 'active' });
        this.activeRuns.delete(runId);
        return;
      }
    }

    // All steps completed
    this._sendSystemMessage(roomId, threadId, `[系统] ✅ 流程完成`);
    this.db.updateWorkflowRun(runId, { status: 'completed', completed_at: new Date().toISOString() });
    this.db.updateThread(threadId, { status: 'active' });
    this.activeRuns.delete(runId);
  }

  /**
   * Execute a single step.
   */
  async _executeStep(runId, workflow, roomId, threadId, step, stepNum, totalSteps) {
    const agent = this.db.getAgentById(step.agent_id);
    const agentName = agent ? agent.name : step.agent_id;

    // Send step announcement
    this._sendSystemMessage(roomId, threadId, `[系统] 步骤 ${stepNum}/${totalSteps} → @${agentName}：${step.prompt}`);

    // Small delay for UI to render
    await new Promise(r => setTimeout(r, 300));

    // Send the prompt as a user message in the thread (so the agent sees it as context)
    this._ensureSystemAgent();
    const promptMsg = this.db.createMessageInThread(roomId, threadId, 'user', step.prompt, 'markdown', null, [step.agent_id]);
    if (this.wsManager) {
      this.wsManager.notifyUI({
        type: 'new_message',
        room_id: roomId,
        thread_id: threadId,
        message: {
          id: promptMsg.id,
          room_id: roomId,
          sender_id: 'user',
          sender_name: '我',
          text: step.prompt,
          thread_id: threadId,
          created_at: new Date().toISOString()
        }
      });
    }

    // Ensure user agent exists
    try {
      this.db.db.prepare(`INSERT OR IGNORE INTO agents (id, name, api_key, description, status) VALUES ('user', '我', '__user__', '用户', 'online')`).run();
    } catch(e) {}

    // Call processMessage with threadId so it uses thread context
    await processMessage(this.db, this.wsManager, roomId, 'user', step.prompt, [step.agent_id], 'group', 0, threadId);

    // Wait for the agent's reply to appear (poll for up to 60 seconds)
    if (step.wait_for_reply !== false) {
      const startTime = Date.now();
      const timeout = 120000; // 2 minutes
      while (Date.now() - startTime < timeout) {
        // Check if cancelled
        const runState = this.activeRuns.get(runId);
        if (runState && runState.cancelled) return;

        const msgs = this.db.getThreadMessages(threadId, 5);
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.sender_id === step.agent_id) {
          // Agent has replied
          return;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error(`等待 @${agentName} 回复超时`);
    }
  }

  /**
   * Cancel a running workflow.
   */
  async cancel(runId) {
    const runState = this.activeRuns.get(runId);
    if (runState) {
      runState.cancelled = true;
    } else {
      // Run might not be in memory (already finished or server restarted)
      const run = this.db.getWorkflowRun(runId);
      if (run && run.status === 'running') {
        this.db.updateWorkflowRun(runId, { status: 'cancelled', completed_at: new Date().toISOString() });
        const thread = this.db.getThread(run.thread_id);
        if (thread) {
          this.db.updateThread(thread.id, { status: 'active' });
        }
      }
    }
  }
}

module.exports = WorkflowRunner;
