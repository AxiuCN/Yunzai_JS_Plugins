// 插件作者 阿修Axiu
// 开源地址 https://github.com/AxiuCN/Yunzai_JS_Plugins
// plugins/example/面板图图库管理器.js
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const GALLERY_PATH = path.join(process.cwd(), 'plugins/miao-plugin/resources/profile/normal-character')
const GIT_WORK_DIR = path.join(process.cwd(), 'plugins/miao-plugin/resources/profile')

export class ProfileImageManager extends plugin {
  constructor() {
    super({
      name: '面板图图库管理器',
      dsc: '管理 normal-character 角色面板图库',
      event: 'message',
      priority: 500,
      task: {
        name: '图库自动检查更新',
        cron: '0 30 6 * * *',
        fnc: () => this.autoCheck(),
        log: true
      },
      rule: [
        { reg: '^#图库状态$', fnc: 'status' },
        { reg: '^#更新图库$', fnc: 'update', permission: 'master' },
        { reg: '^#强制更新图库$', fnc: 'forceUpdate', permission: 'master' }
      ]
    })
  }

  // ========== 工具方法 ==========

  gitExec(command, timeout = 10000) {
    return execSync(command, {
      cwd: GIT_WORK_DIR,
      encoding: 'utf8',
      timeout
    }).trim()
  }

  checkGallery() {
    if (!fs.existsSync(GALLERY_PATH)) {
      return { ok: false, msg: '[面板图图库管理器] 图库目录不存在，请先安装图库' }
    }
    if (!fs.existsSync(path.join(GIT_WORK_DIR, '.git'))) {  // 检查 profile 目录下的 .git
      return { ok: false, msg: '[面板图图库管理器] 图库未初始化 Git，请重新安装图库' }
    }
    return { ok: true }
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  getDirSize(dirPath) {
    let size = 0
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
    files.forEach(file => {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        size += this.getDirSize(filePath)
      } else {
        size += fs.statSync(filePath).size
      }
    })
    return size
  }

  getLocalVersion() {
    try {
      const sha = this.gitExec('git rev-parse --short HEAD')
      const date = this.gitExec('git log -1 --format=%ci')
      return { sha, date }
    } catch (e) {
      return null
    }
  }

  getRemoteSha() {
    try {
      this.gitExec('git fetch origin main', 30000)
      return this.gitExec('git rev-parse --short origin/main')
    } catch (e) {
      return null
    }
  }

  forceResetToRemote() {
    this.gitExec('git reset --hard origin/main', 30000)
  }

  notifyMaster(msg) {
    if (Bot.masterQQ && Bot.masterQQ.length > 0) {
      Bot.masterQQ.forEach(qq => Bot.pickFriend(qq).sendMsg(msg))
    }
  }

  // ========== 核心功能 ==========

  async autoCheck() {
    const check = this.checkGallery()
    if (!check.ok) return

    try {
      const remoteSha = this.getRemoteSha()
      if (!remoteSha) return

      const localSha = this.gitExec('git rev-parse --short HEAD')
      if (remoteSha === localSha) return

      try {
        this.gitExec('git pull origin main --allow-unrelated-histories', 30000)
        const msg = '[面板图图库管理器] 自动更新成功\n' + localSha + ' -> ' + remoteSha
        this.notifyMaster(msg)
        logger.info('[面板图图库管理器] 自动更新成功: ' + localSha + ' -> ' + remoteSha)
      } catch (pullErr) {
        const errorMsg = pullErr.stderr || pullErr.stdout || pullErr.message || '未知错误'
        const msg = '[面板图图库管理器] 自动更新失败\n检测到新版本 ' + remoteSha + '\n错误信息：' + errorMsg + '\n请手动执行 #强制更新图库'
        this.notifyMaster(msg)
        logger.error('[面板图图库管理器] 自动更新失败:', pullErr)
      }
    } catch (err) {
      logger.error('[面板图图库管理器] 自动检查更新失败:', err)
    }
  }

  async status(e) {
    const check = this.checkGallery()
    if (!check.ok) return e.reply(check.msg)

    const files = fs.readdirSync(GALLERY_PATH, { withFileTypes: true })
    const charCount = files.filter(f => f.isDirectory() && f.name !== '.git').length
    const totalSize = this.getDirSize(GALLERY_PATH)
    const version = this.getLocalVersion()

    let msg = '[面板图图库管理器]\n'
    msg += '角色数：' + charCount + '\n'
    msg += '总大小：' + this.formatSize(totalSize) + '\n'
    if (version) {
      msg += '版本：' + version.sha + '\n'
      msg += '时间：' + version.date + '\n'
    } else {
      msg += '无法获取版本信息\n'
    }
    return e.reply(msg)
  }

  async update(e) {
    const check = this.checkGallery()
    if (!check.ok) return e.reply(check.msg)

    try {
      const result = this.gitExec('git pull', 30000)
      const output = result || 'Already up to date.'
      return e.reply('[面板图图库管理器] 图库更新成功\n' + output)
    } catch (err) {
      const errorMsg = err.stderr || err.stdout || err.message || '未知错误'
      let msg = '[面板图图库管理器] 图库自动更新失败，请尝试使用 #强制更新图库\n'
      msg += '错误信息：' + errorMsg
      return e.reply(msg)
    }
  }

  async forceUpdate(e) {
    const check = this.checkGallery()
    if (!check.ok) return e.reply(check.msg)

    try {
      this.getRemoteSha()
      this.forceResetToRemote()
      return e.reply('[面板图图库管理器] 强制更新成功')
    } catch (err) {
      const errorMsg = err.stderr || err.stdout || err.message || '未知错误'
      return e.reply('[面板图图库管理器] 强制更新失败\n' + errorMsg + '\n请检查网络或手动执行安装命令')
    }
  }
}