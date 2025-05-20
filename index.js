// 所有接口
const express = require("express");
const multer = require("multer");
const { v4 } = require("uuid");
const axios = require("axios");
const cors = require('cors');
const sharp = require('sharp')
const mongoose = require('mongoose');
const { User, Admin, TravelNote } = require("./db");
const app = express();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

// 视频上传 前置操作 => 中间件
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './videos'); // 视频文件的保存路径
  },
  filename: (req, file, cb) => {
    const fileExt = file.originalname.split('.').pop(); // 获取文件扩展名
    cb(null, `${v4()}.${fileExt}`); // 使用uuid生成唯一文件名
  }
});
const videoUpload = multer({ storage: videoStorage });

// 图片上传 前置操作 => 中间件
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./file")
  },
  filename: (req, file, cb) => {
    let type = file.originalname.replace(/.+\./, ".");
    console.log(type);
    cb(null, `${v4()}${type}`)
  }
})
const upload = multer({ storage });

// 针对所有接口
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 60, // 每分钟最多60次
  message: '请求过于频繁，请稍后再试'
});
app.use(limiter);

// 获取首页的游记数据
app.get("/getTravelNotes", async (req, res) => {
  try {
    const result = await TravelNote.aggregate([
      {
        $match: {
          state: 1, // 筛选已通过审核的游记
          isDeleted: false // 确保游记未被伪删除
        }
      },
      {
        $lookup: {
          from: "users", // 这应该是User集合在数据库中的实际名称
          localField: "openid", // TravelNote集合中用于匹配的字段
          foreignField: "_id", // User集合中用于匹配的字段
          as: "userInfo" // 添加到游记文档中的用户信息数组
        }
      },
      {
        $unwind: "$userInfo" // 将userInfo数组展开成单个文档
      },
      {
        $sort: { publishTime: -1 } // 根据发布时间降序排序
      }
    ]);
    res.send(result);
  } catch (error) {
    console.error("获取游记数据失败", error);
    res.status(500).send("Server Error");
  }
});

// 获取游记详情(从查询参数中获取游记ID)
app.get("/getTravelNoteDetail", async (req, res) => {
  const { _id } = req.query; // 从查询参数中获取游记ID
  console.log(_id);
  try {
    // 使用聚合管道查询游记详情，并连表查询用户信息
    const result = await TravelNote.aggregate([
      {
        $match: { _id: new mongoose.Types.ObjectId(_id) } // 将_id字符串转换为ObjectId
      },
      {
        $lookup: {
          from: "users", // 连接到用户集合
          localField: "openid", // 游记集合中用于匹配的字段
          foreignField: "_id", // 用户集合中用于匹配的字段
          as: "userInfo" // 查询结果的字段名
        }
      },
      {
        $unwind: "$userInfo" // 展开userInfo，使其从数组变为单个对象
      }
    ]);

    if (result.length === 0) { // 检查是否查询到了游记
      return res.status(404).send({ message: "TravelNote not found" });
    }

    // 直接返回查询结果
    res.status(200).send(result[0]); // 由于_id唯一，关心第一个元素即可
  } catch (error) {
    console.error("Error getting travel note detail:", error);
    res.status(500).send({ message: "Internal Server Error", error });
  }
});

// 发布游记
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 10, // 每分钟最多10次写入
  message: '操作过于频繁，请稍后再试'
});
app.use('/publishTravelNote', writeLimiter);

app.post("/publishTravelNote", [
  body('title').isString().isLength({ min: 1, max: 100 }),
  body('content').isString().isLength({ min: 1, max: 5000 }),
  // 其他字段校验
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: '参数不合法', errors: errors.array() });
  }
  const { id, title, content, imgList, openid, videoUrl } = req.body;

  try {
    let result;
    if (id) {
      // 如果请求中包含ID，则更新已存在的游记
      result = await TravelNote.findByIdAndUpdate(
        id,
        { title, content, imgList, openid, state: 0, video: videoUrl },
        { new: true, runValidators: true, upsert: true }
      );
    } else {
      // 如果请求中不包含ID，则创建新的游记
      result = await TravelNote.create({ title, content, imgList, openid, state: 0, video: videoUrl }); // 假设state: 0 表示待审核状态
    }

    // 根据操作结果返回相应的响应
    if (result) {
      res.status(200).send({ message: "Success", data: result });
    } else {
      res.status(404).send({ message: "Not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Error", detail: error.message });
  }
});

// 上传图片(不压缩)
// app.post("/uploadImg", upload.array("file", 6), (req, res) => {
//   // 假设您的服务器地址是 http://localhost:3001 ，在生产环境中，您应该使用实际的服务器地址
//   const serverUrl = "http://localhost:3001";
//   // 转换req.files中的每个文件路径，拼接成完整的URL
//   const filesWithFullPath = req.files.map(file => {
//     return `${serverUrl}/${file.path}`;
//   });
//   console.log(filesWithFullPath);

//   res.send(filesWithFullPath);
// });


// 上传图片（压缩）
app.post("/uploadImg", upload.array("file", 6), async (req, res) => {
  try {
    const processedFiles = await Promise.all(req.files.map(async (file) => {
      const serverUrl = "http://localhost:3001";
      const outputPath = `./optimized/${file.filename}.webp`;
      // 使用sharp进行图片处理，转换为WebP格式
      await sharp(file.path)
        .resize(400) // 假设最大宽度为800px
        .webp({ quality: 70 }) // 转换为WebP格式，设置质量为80%，保留透明度
        .toFile(outputPath);
      return `${serverUrl}/${outputPath}`;
    }));
    res.send(processedFiles);
  } catch (error) {
    console.error("Error processing files", error);
    res.status(500).send("Server Error");
  }
});

// 上传视频的接口 输入一个视频流文件 => 存储的本机地址
app.post('/uploadVideo', videoUpload.single('video'), (req, res) => {
  const serverUrl = "http://localhost:3001/";
  if (req.file) {
    console.log(req.file.path); // 打印上传文件的保存路径
    res.send({ message: 'Video uploaded successfully', path: serverUrl + req.file.path });
  } else {
    res.status(400).send({ message: 'Video upload failed' });
  }
});

// 获取我的发布的数据
app.get("/getMyPublish", async (req, res) => {
  const { openid } = req.query;
  const result = await TravelNote.find({
    openid: openid,
    isDeleted: false // 确保只返回未被伪删除的记录
  });
  res.send(result);
})

// 登录
app.post("/toLogin", async (req, res) => {
  const { username, password } = req.body;
  const result = await User.findOne({
    username
  });
  if (result) {
    if (result.password === password) {
      res.send(result);
    } else {
      res.send("pwdError")
    }
  } else {
    res.send("error");
  }
})

// 注册
app.post('/register', writeLimiter, async (req, res) => {
  const { username, password, date, avatarUrl } = req.body;
  const result = await User.findOne({
    username
  });
  if (result) {
    res.send("用户名不能重复");
  } else {
    await User.create({
      username,
      password,
      date,
      avatar: avatarUrl,
    });
    res.send("success");
  }
})

// 更换头像
app.post('/updateAvatar', async (req, res) => {
  const { openid, avatarUrl } = req.body; // 假设你会在请求体中传递用户的openid和新的头像URL

  try {
    // 在数据库中找到对应的用户并更新他们的avatar字段
    const updatedUser = await User.findOneAndUpdate({ _id: openid }, { avatar: avatarUrl }, { new: true });

    if (updatedUser) {
      // 如果找到并成功更新了用户信息，返回成功消息
      res.status(200).send({ message: 'Avatar updated successfully', data: updatedUser });
    } else {
      // 如果没有找到对应的用户，返回404错误
      res.status(404).send({ message: 'User not found' });
    }
  } catch (error) {
    // 如果在更新过程中发生了错误，返回500错误和错误信息
    console.error(error);
    res.status(500).send({ message: 'Error updating avatar', detail: error.message });
  }
});

// 更新联系方式
app.post('/updatePhone', async (req, res) => {
  const { openid, phone } = req.body;

  try {
    // 在数据库中找到对应的用户并更新他们的phone字段
    const updatedUser = await User.findOneAndUpdate(
      { _id: openid }, 
      { phone: phone }, 
      { new: true }
    );

    if (updatedUser) {
      // 如果找到并成功更新了用户信息，返回成功消息
      res.status(200).send({ 
        message: 'Phone updated successfully', 
        data: updatedUser 
      });
    } else {
      // 如果没有找到对应的用户，返回404错误
      res.status(404).send({ message: 'User not found' });
    }
  } catch (error) {
    // 如果在更新过程中发生了错误，返回500错误和错误信息
    console.error(error);
    res.status(500).send({ 
      message: 'Error updating phone', 
      detail: error.message 
    });
  }
});

// 微信小程序中的搜索
app.get("/searchTravelNotes", async (req, res) => {
  const { title } = req.query;
  const regexTitle = new RegExp(title, 'i'); // 创建正则表达式，'i' 代表不区分大小写

  try {
    const results = await TravelNote.aggregate([
      {
        // 将游记数据与用户数据进行联表查询
        $lookup: {
          from: "users", // 这应该是User集合在数据库中的实际名称
          localField: "openid", // TravelNote集合中用于匹配的字段
          foreignField: "_id", // User集合中用于匹配的字段
          as: "userInfo" // 添加到游记文档中的用户信息数组
        }
      },
      {
        // 展开userInfo数组，使其变成对象
        $unwind: "$userInfo"
      },
      {
        // 根据游记标题或用户昵称进行搜索
        $match: {
          $or: [
            { "title": regexTitle }, // 匹配游记标题
            { "userInfo.username": regexTitle } // 匹配用户昵称
          ]
        }
      }
    ]);

    res.status(200).send(results);
  } catch (error) {
    console.error("Search Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// 删除用户信息 真删除
// app.post("/admin/deleteUser", async (req, res) => {
//   const { _id } = req.body;
//   try {
//     await User.findByIdAndRemove(_id);
//     res.send("success");
//   } catch (error) {
//     res.send("error");
//   }
// })

// 伪删除游记(PC、小程序)
app.post("/deleteTravelNote", async (req, res) => {
  const { _id } = req.body;
  try {
    // 更新isDeleted字段为true而不是实际删除记录
    const updated = await TravelNote.findByIdAndUpdate(
      _id,
      { isDeleted: true },
      { new: true }
    );
    if (updated) {
      res.send("success");
    } else {
      // 如果没有找到对应的游记来更新
      res.status(404).send("Not found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("error");
  }
});

// PC 恢复被伪删除的游记
app.post("/restoreTravelNote", async (req, res) => {
  const { _id } = req.body;
  try {
    const restored = await TravelNote.findByIdAndUpdate(
      _id,
      { isDeleted: false },
      { new: true }
    );
    if (restored) {
      res.send("success");
    } else {
      // 如果没有找到对应的游记来更新
      res.status(404).send("Not found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("error");
  }
});

// PC 登录
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(username, password);
  const result = await Admin.findOne({
    username
  })
  if (result && result.password === password) {
    console.log(123);
    // 登录成功
    res.send(result);
  } else {
    res.send("error");
  }
})

// PC 审核游记，包括通过和驳回
app.post('/reviewTravelNote', async (req, res) => {
  const { _id, state, rejectReason } = req.body; // 接收驳回原因
  try {
    const updateData = { state };
    if (state === 2 && rejectReason) { // 如果是驳回状态，并且有驳回原因
      updateData.rejectReason = rejectReason;
    }
    await TravelNote.findByIdAndUpdate(_id, updateData);
    res.send("success");
  } catch (error) {
    console.error(error);
    res.status(500).send("error");
  }
});


// PC 获取后台游记列表（含搜索）
app.post("/admin/getTravelNotes", async (req, res) => { 
  let { page, size, search, status } = req.body;
  page = Math.max(Number(page) || 1, 1);
  size = Math.min(Math.max(Number(size) || 10, 1), 50); // 每页最多50条
  const skipAmount = (page - 1) * size;
  let regexSearch = search;
  let searchQuery = [];
  const emumObj = {
      "待审核": 0,
      "已通过": 1,
      "已驳回": 2,
  };

  if (emumObj[search] || emumObj[search] === 0) {
      searchQuery = [{ "state": emumObj[search] }];
  } else {
      regexSearch = new RegExp(search, 'i'); 
      searchQuery = [{ "title": regexSearch }, { "userInfo.username": regexSearch }];
  }

  let statusQuery = [];
  // 修改状态筛选逻辑，直接使用数字状态值
  if (status !== null && status !== undefined) {
      statusQuery = [{ "state": status }];
  }

  let combinedQuery = [];
  if (searchQuery.length > 0 && statusQuery.length > 0) {
      combinedQuery = [
          {
              $and: [
                  { $or: searchQuery },
                  { $or: statusQuery }
              ]
          }
      ];
  } else if (searchQuery.length > 0) {
      combinedQuery = searchQuery;
  } else if (statusQuery.length > 0) {
      combinedQuery = statusQuery;
  }

  try {
      const pipeline = [
          {
              $lookup: {
                  from: "users",
                  localField: "openid",
                  foreignField: "_id",
                  as: "userInfo"
              }
          },
          {
              $unwind: {
                  path: "$userInfo",
                  preserveNullAndEmptyArrays: true
              }
          },
          {
              $match: {
                  $or: [
                      ...combinedQuery
                  ]
              }
          },
          {
              $sort: { publishTime: -1 }
          },
          {
              $skip: skipAmount
          },
          {
              $limit: size
          }
      ];

      const result = await TravelNote.aggregate(pipeline);

      const totalPipeline = [
          {
              $lookup: {
                  from: "users",
                  localField: "openid",
                  foreignField: "_id",
                  as: "userInfo"
              }
          },
          {
              $unwind: {
                  path: "$userInfo",
                  preserveNullAndEmptyArrays: true
              }
          },
          {
              $match: {
                  $or: [
                      ...combinedQuery
                  ]
              }
          },
          {
              $count: "total"
          }
      ];

      const total = await TravelNote.aggregate(totalPipeline);
      const totalCount = total.length? total[0].total : 0;

      res.send({
          result,
          total: totalCount
      });
  } catch (error) {
      console.error("Error getting travel notes with user info:", error);
      res.status(500).send("Server Error");
  }
});
  // 获取仪表盘统计数据
app.get("/admin/getDashboardStats", async (req, res) => {
  try {
    // 日记总数
    const totalNotes = await TravelNote.countDocuments({ isDeleted: false });
    
    // 用户总数
    const totalUsers = await User.countDocuments();
    
    // 待审核数
    const pendingNotes = await TravelNote.countDocuments({ 
      state: 0, 
      isDeleted: false 
    });
    
    // 已通过数
    const approvedNotes = await TravelNote.countDocuments({ 
      state: 1, 
      isDeleted: false 
    });
    
    // 被拒绝数
    const rejectedNotes = await TravelNote.countDocuments({ 
      state: 2, 
      isDeleted: false 
    });

    res.status(200).send({
      totalNotes,
      totalUsers,
      pendingNotes,
      approvedNotes,
      rejectedNotes
    });
  } catch (error) {
    console.error("Error getting dashboard stats:", error);
    res.status(500).send("Server Error");
  }
});
// 获取最近发布的日记(管理员用)
app.get("/admin/getRecentNotes", async (req, res) => {
  try {
    // 获取最近10条发布的日记，按发布时间降序排序
    const recentNotes = await TravelNote.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "openid",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      {
        $unwind: {
          path: "$userInfo",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $sort: { publishTime: -1 }  // 按发布时间降序排序
      },
      {
        $limit: 10  // 只获取最近的10条记录
      }
    ]);

    res.status(200).send(recentNotes);
  } catch (error) {
    console.error("Error getting recent travel notes:", error);
    res.status(500).send("Server Error");
  }
});

// 文本美化接口
app.post("/beautifyText", async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({
      success: false,
      message: '文本内容不能为空'
    });
  }

  try {
    console.log('开始调用讯飞星火API，文本长度:', text.length);
    
    const response = await axios({
      url: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer aEQiuImWkdmgOxqOcFai:JiyUNSHwLlEjaIlrAyOe`
      },
      data: {
        model: "generalv3.5",
        messages: [
          {
            role: "system",
            content: "你是一个专业的文本美化助手，擅长将普通文本改写得更加优美流畅。"
          },
          {
            role: "user",
            content: `请帮我美化以下文本，使其更加优美流畅：${text}`
          }
        ],
        temperature: 0.5,
        top_k: 4,
        stream: false,
        max_tokens: 2048,
        presence_penalty: 1,
        frequency_penalty: 1
      },
      timeout: 30000 // 设置30秒超时
    });

    console.log('API响应状态:', response.status);
    console.log('API响应数据:', JSON.stringify(response.data, null, 2));

    if (response.data && response.data.choices && response.data.choices[0]) {
      const beautifiedText = response.data.choices[0].message.content;
      console.log('美化后的文本长度:', beautifiedText.length);
      
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json({
        success: true,
        beautifiedText: beautifiedText
      });
    } else {
      console.error('API返回数据格式不正确:', response.data);
      res.status(400).json({
        success: false,
        message: '美化失败：返回数据格式不正确'
      });
    }
  } catch (error) {
    console.error('文本美化失败，详细错误信息:', error);
    
    res.setHeader('Content-Type', 'application/json');
    
    if (error.response) {
      console.error('API错误响应状态:', error.response.status);
      console.error('API错误响应数据:', error.response.data);
      
      res.status(500).json({
        success: false,
        message: `API错误: ${error.response.status} - ${error.response.data?.message || '未知错误'}`
      });
    } else if (error.request) {
      console.error('请求发送失败:', error.request);
      res.status(500).json({
        success: false,
        message: '无法连接到讯飞API服务器'
      });
    } else {
      console.error('其他错误:', error.message);
      res.status(500).json({
        success: false,
        message: `服务器错误: ${error.message}`
      });
    }
  } finally {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: '服务器内部错误'
      });
    }
  }
});

app.listen(3001, () => {
  console.log('server running!');
})