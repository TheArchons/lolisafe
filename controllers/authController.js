const bcrypt = require('bcrypt')
const config = require('./../config')
const db = require('knex')(config.database)
const randomstring = require('randomstring')
const utils = require('./utilsController')

const authController = {}

authController.permissions = {
  user: 0, // upload & delete own files, create & delete albums
  moderator: 50, // delete other user's files
  admin: 80, // manage users (disable accounts) & create moderators
  superadmin: 100 // create admins
  // groups will inherit permissions from groups which have lower value
}

authController.is = (user, group) => {
  // root bypass
  if (user.username === 'root') { return true }
  const permission = user.permission || 0
  return permission >= authController.permissions[group]
}

authController.higher = (user, target) => {
  const userPermission = user.permission || 0
  const targetPermission = target.permission || 0
  return userPermission > targetPermission
}

authController.mapPermissions = user => {
  const map = {}
  Object.keys(authController.permissions).forEach(group => {
    map[group] = authController.is(user, group)
  })
  return map
}

authController.verify = async (req, res, next) => {
  const username = req.body.username
  const password = req.body.password

  if (username === undefined) { return res.json({ success: false, description: 'No username provided.' }) }
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  const user = await db.table('users').where('username', username).first()
  if (!user) {
    return res.json({ success: false, description: 'Username doesn\'t exist.' })
  }
  if (user.enabled === false || user.enabled === 0) {
    return res.json({ success: false, description: 'This account has been disabled.' })
  }

  bcrypt.compare(password, user.password, (error, result) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'There was an error.' })
    }
    if (result === false) { return res.json({ success: false, description: 'Wrong password.' }) }
    return res.json({ success: true, token: user.token })
  })
}

authController.register = async (req, res, next) => {
  if (config.enableUserAccounts === false) {
    return res.json({ success: false, description: 'Register is disabled at the moment.' })
  }

  const username = req.body.username
  const password = req.body.password

  if (username === undefined) { return res.json({ success: false, description: 'No username provided.' }) }
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  if (username.length < 4 || username.length > 32) {
    return res.json({ success: false, description: 'Username must have 4-32 characters.' })
  }
  if (password.length < 6 || password.length > 64) {
    return res.json({ success: false, description: 'Password must have 6-64 characters.' })
  }

  const user = await db.table('users').where('username', username).first()
  if (user) { return res.json({ success: false, description: 'Username already exists.' }) }

  bcrypt.hash(password, 10, async (error, hash) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'Error generating password hash (╯°□°）╯︵ ┻━┻.' })
    }
    const token = randomstring.generate(64)
    await db.table('users').insert({
      username,
      password: hash,
      token,
      enabled: 1,
      permission: authController.permissions.user
    })
    return res.json({ success: true, token })
  })
}

authController.changePassword = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const password = req.body.password
  if (password === undefined) { return res.json({ success: false, description: 'No password provided.' }) }

  if (password.length < 6 || password.length > 64) {
    return res.json({ success: false, description: 'Password must have 6-64 characters.' })
  }

  bcrypt.hash(password, 10, async (error, hash) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'Error generating password hash (╯°□°）╯︵ ┻━┻.' })
    }

    await db.table('users')
      .where('id', user.id)
      .update('password', hash)

    return res.json({ success: true })
  })
}

authController.getFileLengthConfig = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }
  return res.json({
    success: true,
    fileLength: user.fileLength,
    config: config.uploads.fileLength
  })
}

authController.changeFileLength = async (req, res, next) => {
  if (config.uploads.fileLength.userChangeable === false) {
    return res.json({
      success: false,
      description: 'Changing file name length is disabled at the moment.'
    })
  }

  const user = await utils.authorize(req, res)
  if (!user) { return }

  const fileLength = parseInt(req.body.fileLength)
  if (fileLength === undefined) {
    return res.json({
      success: false,
      description: 'No file name length provided.'
    })
  }
  if (isNaN(fileLength)) {
    return res.json({
      success: false,
      description: 'File name length is not a valid number.'
    })
  }

  if (fileLength < config.uploads.fileLength.min || fileLength > config.uploads.fileLength.max) {
    return res.json({
      success: false,
      description: `File name length must be ${config.uploads.fileLength.min} to ${config.uploads.fileLength.max} characters.`
    })
  }

  if (fileLength === user.fileLength) {
    return res.json({ success: true })
  }

  await db.table('users')
    .where('id', user.id)
    .update('fileLength', fileLength)

  return res.json({ success: true })
}

authController.editUser = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const id = parseInt(req.body.id)
  if (isNaN(id)) {
    return res.json({ success: false, description: 'No user specified.' })
  }

  const target = await db.table('users')
    .where('id', id)
    .first()

  if (!target) {
    return res.json({ success: false, description: 'Could not get user with the specified ID.' })
  } else if (!authController.higher(user, target)) {
    return res.json({ success: false, description: 'The user is in the same or higher group as you.' })
  } else if (target.username === 'root') {
    return res.json({ success: false, description: 'Root user may not be edited.' })
  }

  const username = String(req.body.username)
  if (username.length < 4 || username.length > 32) {
    return res.json({ success: false, description: 'Username must have 4-32 characters.' })
  }

  let permission = req.body.group ? authController.permissions[req.body.group] : target.permission
  if (typeof permission !== 'number' || permission < 0) { permission = target.permission }

  await db.table('users')
    .where('id', id)
    .update({
      username,
      enabled: Boolean(req.body.enabled),
      permission
    })

  if (!req.body.resetPassword) {
    return res.json({ success: true, username })
  }

  const password = randomstring.generate(16)
  bcrypt.hash(password, 10, async (error, hash) => {
    if (error) {
      console.error(error)
      return res.json({ success: false, description: 'Error generating password hash (╯°□°）╯︵ ┻━┻.' })
    }

    await db.table('users')
      .where('id', id)
      .update('password', hash)

    return res.json({ success: true, password })
  })
}

authController.listUsers = async (req, res, next) => {
  const user = await utils.authorize(req, res)
  if (!user) { return }

  const isadmin = authController.is(user, 'admin')
  if (!isadmin) { return res.status(403) }

  let offset = req.params.page
  if (offset === undefined) { offset = 0 }

  const users = await db.table('users')
    // .orderBy('id', 'DESC')
    .limit(25)
    .offset(25 * offset)
    .select('id', 'username', 'enabled', 'fileLength', 'permission')

  const userids = []

  for (const user of users) {
    user.groups = authController.mapPermissions(user)
    delete user.permission

    userids.push(user.id)
    user.uploadsCount = 0
  }

  if (!userids.length) { return res.json({ success: true, users }) }

  const maps = {}
  const uploads = await db.table('files').whereIn('userid', userids)
  for (const upload of uploads) {
    // This is the fastest method that I can think of
    if (maps[upload.userid] === undefined) { maps[upload.userid] = 0 }
    maps[upload.userid]++
  }

  for (const user of users) {
    user.uploadsCount = maps[user.id] || 0
  }

  return res.json({ success: true, users })
}

module.exports = authController
