// 插件作者 阿修Axiu
// 开源地址 https://github.com/AxiuCN/Yunzai_JS_Plugins
// plugins/example/面板图图库管理器.js
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const GALLERY_PATH = path.join(process.cwd(), 'plugins/miao-plugin/resources/profile/normal-character')
const BLOCKED_GALLERY_PATH = path.join(process.cwd(), 'plugins/miao-plugin/resources/profile/blocked-character')
const GIT_WORK_DIR = path.join(process.cwd(), 'plugins/miao-plugin/resources/profile')
const BLOCKED_GIT_DIR = path.join(BLOCKED_GALLERY_PATH, '.git')
const MAIN_REPO_URL = 'https://github.com/AxiuCN/miao-plugin-ProfileImg.git'
const BLOCKED_REPO_URL = 'https://github.com/AxiuCN/miao-plugin-ProfileImg-Blocked.git'

export class ProfileImageManager extends plugin {
  constructor() {
    super({
      name: '面板图图库管理器',
      dsc: '管理 normal-character 角色面板图库及屏蔽图库',
      event: 'message',
      priority: 500,
      rule: [
        // 图库总览
        { reg: '^#图库状态$', fnc: 'overallStatus' },
        // 主图库
        { reg: '^#主图库状态$', fnc: 'status' },
        { reg: '^#更新图库$', fnc: 'update', permission: 'master' },
        { reg: '^#强制更新图库$', fnc: 'forceUpdate', permission: 'master' },
        { reg: '^#下载主图库$', fnc: 'downloadMain', permission: 'master' },
        // 屏蔽图库
        { reg: '^#屏蔽图库状态$', fnc: 'blockedStatus' },
        { reg: '^#下载屏蔽图库$', fnc: 'downloadBlocked', permission: 'master' },
        { reg: '^#(.+)面板图屏蔽列表$', fnc: 'blockedImgList' },
        // 面板图迁移
        { reg: '^#屏蔽(.+)面板图\\s*(\\d*)$', fnc: 'blockImg', permission: 'master' },
        { reg: '^#启用(.+?)(屏蔽)?面板图\\s*(\\d*)$', fnc: 'unblockImg', permission: 'master' }
      ]
    })

    // 定时任务
    this.task = [
      {
        name: '主图库自动检查更新',
        cron: '0 30 6 * * *',
        fnc: () => this.autoCheck(),
        log: true
      },
      {
        name: '管理器自身自动更新',
        cron: '50 5 * * *',
        fnc: () => this.selfUpdate(),
        log: false
      }
    ]
  }

  // ==================== 工具方法 ====================

  gitExec(command, timeout = 10000) {
    return execSync(command, { cwd: GIT_WORK_DIR, encoding: 'utf8', timeout }).trim()
  }

  gitExecAt(dir, command, timeout = 10000) {
    return execSync(command, { cwd: dir, encoding: 'utf8', timeout }).trim()
  }

  checkGallery() {
    if (!fs.existsSync(GALLERY_PATH)) {
      return { ok: false, msg: '[面板图图库管理器] 图库目录不存在，请先安装图库' }
    }
    if (!fs.existsSync(path.join(GIT_WORK_DIR, '.git'))) {
      return { ok: false, msg: '[面板图图库管理器] 图库未初始化 Git，请重新安装图库' }
    }
    return { ok: true }
  }

  checkBlockedGallery() {
      if (!fs.existsSync(BLOCKED_GALLERY_PATH)) {
          return { ok: false, msg: '[面板图图库管理器] 屏蔽图库目录不存在，请先安装屏蔽图库' }
      }
      if (!fs.existsSync(BLOCKED_GIT_DIR)) {
          return { ok: false, msg: '[面板图图库管理器] 屏蔽图库未初始化 Git，请重新安装屏蔽图库' }
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

  countImages(dirPath) {
    let count = 0
    if (!fs.existsSync(dirPath)) return 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.git') {
        count += this.countImages(path.join(dirPath, entry.name))
      } else if (/\.(webp|png|jpg|jpeg|gif)$/i.test(entry.name)) {
        count++
      }
    }
    return count
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

  getLocalVersionAt(dir) {
    try {
      const sha = this.gitExecAt(dir, 'git rev-parse --short HEAD')
      const date = this.gitExecAt(dir, 'git log -1 --format=%ci')
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

  getBlockedInfo() {
      let charCount = 0
      let totalSize = 0
      let imageCount = 0
      if (!fs.existsSync(BLOCKED_GALLERY_PATH)) return { charCount, totalSize, imageCount }
      const charDirs = fs.readdirSync(BLOCKED_GALLERY_PATH, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name !== '.git')
      for (const charDir of charDirs) {
          const charPath = path.join(BLOCKED_GALLERY_PATH, charDir.name)
          totalSize += this.getDirSize(charPath)
          charCount++
          const files = fs.readdirSync(charPath, { withFileTypes: true })
          imageCount += files.filter(f => f.isFile() && /\.(webp|png|jpg|jpeg|gif)$/i.test(f.name)).length
      }
      return { charCount, totalSize, imageCount }
  }

  /** 获取指定角色的主图库路径 */
  getMainDir(roleName) {
    return path.join(GALLERY_PATH, roleName)
  }

  /** 获取指定角色的屏蔽图库路径 */
  getBlockedDir(roleName) {
    return path.join(BLOCKED_GALLERY_PATH, roleName)
  }

  // ==================== 安装图库 ====================

  async installGallery(repoUrl, targetDir, label, updateCmd) {
    if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, '.git'))) {
      return `[面板图图库管理器] ${label}已安装，请使用 ${updateCmd} 进行更新`
    }
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    try {
      fs.mkdirSync(targetDir, { recursive: true })
      execSync('git init --initial-branch=main', { cwd: targetDir, encoding: 'utf8', timeout: 10000 })
      execSync(`git remote add origin ${repoUrl}`, { cwd: targetDir, encoding: 'utf8', timeout: 10000 })
      execSync('git fetch origin main --depth 1', { cwd: targetDir, encoding: 'utf8', timeout: 60000 })
      execSync('git reset --hard origin/main', { cwd: targetDir, encoding: 'utf8', timeout: 10000 })
      return `[面板图图库管理器] ${label}安装成功！`
    } catch (err) {
      const errorMsg = err.stderr || err.stdout || err.message || '未知错误'
      return `[面板图图库管理器] ${label}安装失败\n${errorMsg}`
    }
  }

  async downloadMain(e) {
    e.reply('[面板图图库管理器] 开始安装主图库，请稍候...')
    const result = await this.installGallery(MAIN_REPO_URL, GIT_WORK_DIR, '主图库', '#更新图库')
    return e.reply(result)
  }

  async downloadBlocked(e) {
      e.reply('[面板图图库管理器] 开始安装屏蔽图库，请稍候...')
      if (!fs.existsSync(path.join(GIT_WORK_DIR, '.git'))) {
          return e.reply('[面板图图库管理器] 主图库未初始化 Git，请先安装主图库')
      }
      if (fs.existsSync(path.join(BLOCKED_GALLERY_PATH, '.git'))) {
          return e.reply('[面板图图库管理器] 屏蔽图库已安装，请使用 #更新屏蔽图库 进行更新')
      }
      try {
          execSync(`git submodule add ${BLOCKED_REPO_URL} blocked-character`, {
              cwd: GIT_WORK_DIR,
              encoding: 'utf8',
              timeout: 30000
          })
          return e.reply('[面板图图库管理器] 屏蔽图库安装成功！')
      } catch (err) {
          const errorMsg = err.stderr || err.stdout || err.message || '未知错误'
          return e.reply('[面板图图库管理器] 屏蔽图库安装失败\n' + errorMsg)
      }
  }

  // ==================== 自动更新 ====================

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

  async selfUpdate() {
    try {
      const remoteUrl = 'https://raw.githubusercontent.com/AxiuCN/Yunzai_JS_Plugins/main/%E9%9D%A2%E6%9D%BF%E5%9B%BE%E5%9B%BE%E5%BA%93%E7%AE%A1%E7%90%86%E5%99%A8.js'
      const localPath = path.join(process.cwd(), 'plugins/example/面板图图库管理器.js')
      const res = await fetch(remoteUrl)
      if (!res.ok) throw new Error('下载失败，HTTP ' + res.status)
      const remoteCode = await res.text()
      const localCode = fs.readFileSync(localPath, 'utf8')
      if (remoteCode.trim() === localCode.trim()) {
        logger.info('[面板图图库管理器] 自身已是最新版本')
        return
      }
      fs.writeFileSync(localPath, remoteCode, 'utf8')
      this.notifyMaster('[面板图图库管理器] 自身已自动更新至最新版本')
      logger.info('[面板图图库管理器] 自身更新成功')
    } catch (err) {
      logger.error('[面板图图库管理器] 自身更新失败:', err)
      this.notifyMaster('[面板图图库管理器] 自身更新失败: ' + (err.message || '未知错误'))
    }
  }

  // ==================== 图库状态查询 ====================

  async status(e) {
    const check = this.checkGallery()
    if (!check.ok) return e.reply(check.msg)
    const files = fs.readdirSync(GALLERY_PATH, { withFileTypes: true })
    const charCount = files.filter(f => f.isDirectory() && f.name !== '.git').length
    const imageCount = this.countImages(GALLERY_PATH)
    const totalSize = this.getDirSize(GALLERY_PATH)
    const version = this.getLocalVersion()
    let msg = '[面板图图库管理器] 主图库\n'
    msg += '角色数：' + charCount + '\n'
    msg += '图片数：' + imageCount + '\n'
    msg += '总大小：' + this.formatSize(totalSize) + '\n'
    if (version) {
      msg += '版本：' + version.sha + '\n'
      msg += '时间：' + version.date + '\n'
    } else {
      msg += '无法获取版本信息\n'
    }
    return e.reply(msg)
  }

  async blockedStatus(e) {
    const check = this.checkBlockedGallery()
    if (!check.ok) return e.reply(check.msg)
    const { charCount, totalSize, imageCount } = this.getBlockedInfo()
    const version = this.getLocalVersionAt(BLOCKED_GALLERY_PATH)
    let msg = '[面板图图库管理器] 屏蔽图库\n'
    msg += '屏蔽角色数：' + charCount + '\n'
    msg += '屏蔽图片数：' + imageCount + '\n'
    msg += '总大小：' + this.formatSize(totalSize) + '\n'
    if (version) {
      msg += '版本：' + version.sha + '\n'
      msg += '时间：' + version.date + '\n'
    } else {
      msg += '无法获取版本信息\n'
    }
    return e.reply(msg)
  }

  async overallStatus(e) {
    const mainCheck = this.checkGallery()
    const blockedCheck = this.checkBlockedGallery()
    let msg = '[面板图图库管理器] 总览\n'
    if (mainCheck.ok) {
      const files = fs.readdirSync(GALLERY_PATH, { withFileTypes: true })
      const mainCharCount = files.filter(f => f.isDirectory() && f.name !== '.git').length
      const imageCount = this.countImages(GALLERY_PATH)
      const mainSize = this.getDirSize(GALLERY_PATH)
      const mainVer = this.getLocalVersion()
      msg += '\n主图库：\n'
      msg += '  角色数：' + mainCharCount + '\n'
      msg += '  图片数：' + imageCount + '\n'
      msg += '  大小：' + this.formatSize(mainSize) + '\n'
      msg += mainVer ? '  版本：' + mainVer.sha + '\n' : '  版本：未知\n'
    } else {
      msg += '\n主图库：未安装\n'
    }
    if (blockedCheck.ok) {
      const { charCount, totalSize, imageCount } = this.getBlockedInfo()
      const blockedVer = this.getLocalVersionAt(BLOCKED_GALLERY_PATH)
      msg += '\n屏蔽图库：\n'
      msg += '  屏蔽角色数：' + charCount + '\n'
      msg += '  屏蔽图片数：' + imageCount + '\n'
      msg += '  大小：' + this.formatSize(totalSize) + '\n'
      msg += blockedVer ? '  版本：' + blockedVer.sha + '\n' : '  版本：未知\n'
    } else {
      msg += '\n屏蔽图库：未安装\n'
    }
    return e.reply(msg)
  }

  // ==================== 主图库更新 ====================

  async update(e) {
    const check = this.checkGallery()
    if (!check.ok) return e.reply(check.msg)
    try {
      const result = this.gitExec('git pull', 30000)
      return e.reply('[面板图图库管理器] 图库更新成功\n' + (result || 'Already up to date.'))
    } catch (err) {
      const errorMsg = err.stderr || err.stdout || err.message || '未知错误'
      return e.reply('[面板图图库管理器] 图库自动更新失败，请尝试使用 #强制更新图库\n错误信息：' + errorMsg)
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

  // ==================== 屏蔽面板图操作 ====================

  async blockedImgList(e) {
    const roleName = e.msg.replace(/^#/, '').replace(/面板图屏蔽列表$/, '').trim()
    if (!roleName) return e.reply('[面板图图库管理器]\n请输入正确的角色名')
    const blockedDir = this.getBlockedDir(roleName)
    if (!fs.existsSync(blockedDir)) return e.reply(`[面板图图库管理器]\n角色「${roleName}」暂无屏蔽面板图`)
    const imgFiles = fs.readdirSync(blockedDir).filter(file => /\.(webp|png|jpg|jpeg|gif)$/i.test(file))
    if (imgFiles.length === 0) return e.reply(`[面板图图库管理器]\n角色「${roleName}」的屏蔽文件夹为空`)
    const msgList = []
    msgList.push({ message: [`当前查看的是${roleName}面板图,共${imgFiles.length}张，可输入【#删除${roleName}面板图(序列号)】进行删除，可输入【#启用${roleName}面板图(序列号)】进行恢复`] })
    imgFiles.forEach((file, idx) => {
      const imgPath = path.join(blockedDir, file)
      msgList.push({ message: [`${idx + 1}.`, segment.image(`file://${imgPath}`)] })
    })
    const forwardMsg = e.group?.makeForwardMsg
      ? await e.group.makeForwardMsg(msgList)
      : e.friend?.makeForwardMsg
        ? await e.friend.makeForwardMsg(msgList)
        : await Bot.makeForwardMsg(msgList)
    const sendRes = await e.reply(forwardMsg)
    if (!sendRes) e.reply('[面板图图库管理器]\n消息发送失败，可能是风控，请稍后重试')
    return true
  }

  async blockImg(e) {
    const rawMsg = e.msg.replace(/^#/, '')
    const match = rawMsg.match(/^屏蔽(.+)面板图\s*(\d*)$/)
    if (!match) return e.reply('[面板图图库管理器]指令格式错误，请使用 #屏蔽角色名面板图 序号')
    const roleName = match[1].trim()
    const idx = parseInt(match[2]) || 1
    const mainDir = this.getMainDir(roleName)
    const blockedDir = this.getBlockedDir(roleName)
    if (!fs.existsSync(mainDir)) return e.reply(`[面板图图库管理器]\n角色${roleName}暂无面板图`)
    const mainFiles = fs.readdirSync(mainDir).filter(f => {
      const fullPath = path.join(mainDir, f)
      return /\.(webp|png|jpg|jpeg|gif)$/i.test(f) && fs.statSync(fullPath).isFile()
    })
    if (mainFiles.length === 0) return e.reply(`[面板图图库管理器]\n角色${roleName}暂无面板图`)
    if (idx < 1 || idx > mainFiles.length) return e.reply(`[面板图图库管理器]\n序号无效，当前有${mainFiles.length}张图`)
    const srcFile = path.join(mainDir, mainFiles[idx - 1])
    if (!fs.existsSync(blockedDir)) fs.mkdirSync(blockedDir, { recursive: true })
    let destFile = path.join(blockedDir, mainFiles[idx - 1])
    if (fs.existsSync(destFile)) {
      const ext = path.extname(mainFiles[idx - 1])
      const base = path.basename(mainFiles[idx - 1], ext)
      let counter = 1
      while (fs.existsSync(path.join(blockedDir, `${base}_${counter}${ext}`))) counter++
      destFile = path.join(blockedDir, `${base}_${counter}${ext}`)
    }
    fs.renameSync(srcFile, destFile)
    return e.reply(`[面板图图库管理器]\n已将${roleName}的第${idx}张图移入屏蔽图库(${path.basename(destFile)})`)
  }

  async unblockImg(e) {
    const rawMsg = e.msg.replace(/^#/, '')
    const match = rawMsg.match(/^启用(.+?)(屏蔽)?面板图\s*(\d*)$/)
    if (!match) return e.reply('[面板图图库管理器]指令格式错误，请使用 #启用角色名面板图 序号')
    const roleName = match[1].trim()
    const idx = parseInt(match[3]) || 1
    const blockedDir = this.getBlockedDir(roleName)
    const mainDir = this.getMainDir(roleName)
    if (!fs.existsSync(blockedDir)) return e.reply(`[面板图图库管理器]\n角色${roleName}暂无屏蔽面板图`)
    const blockedFiles = fs.readdirSync(blockedDir).filter(f => {
      const fullPath = path.join(blockedDir, f)
      return /\.(webp|png|jpg|jpeg|gif)$/i.test(f) && fs.statSync(fullPath).isFile()
    })
    if (blockedFiles.length === 0) return e.reply(`[面板图图库管理器]\n角色${roleName}暂无屏蔽面板图`)
    if (idx < 1 || idx > blockedFiles.length) return e.reply(`[面板图图库管理器]\n序号无效，当前有${blockedFiles.length}张屏蔽图`)
    const srcFile = path.join(blockedDir, blockedFiles[idx - 1])
    let destFile = path.join(mainDir, blockedFiles[idx - 1])
    if (fs.existsSync(destFile)) {
      const ext = path.extname(blockedFiles[idx - 1])
      const base = path.basename(blockedFiles[idx - 1], ext)
      let counter = 1
      while (fs.existsSync(path.join(mainDir, `${base}_${counter}${ext}`))) counter++
      destFile = path.join(mainDir, `${base}_${counter}${ext}`)
    }
    fs.renameSync(srcFile, destFile)
    return e.reply(`[面板图图库管理器]\n已将${roleName}的第${idx}张屏蔽图移回主图库(${path.basename(destFile)})`)
  }
}