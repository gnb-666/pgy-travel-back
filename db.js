const mongoose = require('mongoose');
// 连接mongodb数据库
mongoose.connect("mongodb://127.0.0.1:27017/loseMg")
  .then(() => {
    console.log("数据库连接成功!")
  })
  .catch((err) => {
    console.log("数据库连接失败!", err);
  })
const crypto = require('crypto');
// 实现md5加密
function md5(password) {
  return crypto.createHash('md5').update(password).digest('hex');
}
// 游记表
const TravelNoteSchema = new mongoose.Schema({
  openid: {           // 用户ID
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User' // 可选，但有助于Mongoose理解这是一个引用
  },
  video: {            // 相关视频，存储视频的URL或路径
    type: String,
    default: ''       // 默认为空，可选字段
  },
  title: {            // 标题
    type: String,
    required: true
  },
  content: {          // 内容
    type: String,
    required: true
  },
  imgList: {          // 相关照片，可上传多张
    type: Array,
    required: true,
    default: []
  },
  state: {            // 审核状态：0待审核, 1已通过, 2未通过
    type: Number,
    required: true,
    default: 0
  },
  rejectReason: {
    type: String,
    default: '' // 驳回原因，默认为空
  },
  publishTime: {      // 发布时间
    type: Date,
    // default: Date.now
    default: () => new Date().toLocaleString() // 使用本地时区的当前时间作为默认值
  },
  isDeleted: { // 新增的用于伪删除的字段
    type: Boolean,
    required: true,
    default: false
  }
})
// 用户账号
const UserSchema = new mongoose.Schema({
  openid: {           // 用户ID
    type: String
  },
  username: {         // 用户名
    type: String
  },
  password: {         // 密码
    type: String
  },
  date: {             // 注册时间
    type: Number
  },
  avatar: {           // 头像URL
    type: String,
    default: ''       // Optionally set a default avatar URL
  }
})
// 管理员账号
const AdminSchema = new mongoose.Schema({
  username: {         // 用户名
    type: String
  },
  password: {         // 密码
    type: String
  },
  create_time: {      // 账号创建时间
    type: Number
  },
  role: {             // 角色, 0 管理员 1 审核员
    type: Number
  },
  nickname: {         // 昵称
    type: String
  }
})
const User = mongoose.model("User", UserSchema);
const Admin = mongoose.model("Admin", AdminSchema);
const TravelNote = mongoose.model("TravelNote", TravelNoteSchema);
// 默认创建后台管理员账号
async function createAccounts() {
  await Admin.deleteMany({});
  console.log('所有现有账号已删除');
  try {
    const adminPassword = md5('admin123'); // 使用MD5加密管理员密码
    const auditorPassword = md5('auditor123'); // 使用MD5加密审核员密码

    // 创建管理员账号，密码已加密
    const admin = new Admin({
      username: 'admin',
      password: adminPassword,
      create_time: Date.now(),
      role: 0,
      nickname: '管理员A'
    });

    // 创建审核员账号，密码已加密
    const auditor = new Admin({
      username: 'auditor',
      password: auditorPassword,
      create_time: Date.now(),
      role: 1,
      nickname: '审核员B'
    });

    await admin.save();
    console.log('管理员账号创建成功');

    await auditor.save();
    console.log('审核员账号创建成功');
  } catch (err) {
    console.error('创建账号失败', err);
  }
}
createAccounts();
// 模块导出
module.exports = {
  User,
  Admin,
  TravelNote
}