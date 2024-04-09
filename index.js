const express = require("express");
const multer = require("multer");
const { v4 } = require("uuid");
const axios = require("axios");
const cors = require('cors');
const sharp = require('sharp')
const mongoose = require('mongoose');
const { User, Admin, TravelNote } = require("./db");
const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));


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
  const { page, size, search } = req.body; // 接收一个额外的search参数
  const skipAmount = (page - 1) * size;
  let regexSearch = search
  let searchQuery = []
  const emumObj = {
    "待审核": 0,
    "已通过": 1,
    "已驳回": 2,
  }
  console.log(emumObj[search]);
  if (emumObj[search] || emumObj[search] === 0) {
    searchQuery = [{ "state": emumObj[search] }]
  } else {
    regexSearch = new RegExp(search, 'i'); // 创建正则表达式，'i' 代表不区分大小写
    searchQuery = [{ "title": regexSearch }, { "userInfo.username": regexSearch }] // 根据游记标题进行模糊搜索
  }

  try {
    // 在聚合管道开始处添加一个条件匹配步骤
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
      // 添加搜索条件
      {
        $match: {
          $or: [
            ...searchQuery
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

    // 执行聚合查询
    const result = await TravelNote.aggregate(pipeline);

    // 单独查询满足条件的文档总数，用于分页逻辑
    // 注意：这里需要重用匹配条件
    const total = await TravelNote.aggregate([
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
            { "title": regexSearch },
            { "userInfo.username": regexSearch }
          ]
        }
      },
      {
        $count: "total"
      }
    ]);

    // 如果没有匹配的文档，total将是空数组
    const totalCount = total.length ? total[0].total : 0;

    res.send({
      result,
      total: totalCount
    });
  } catch (error) {
    console.error("Error getting travel notes with user info:", error);
    res.status(500).send("Server Error");
  }
});

app.listen(3001, () => {
  console.log('server running!');
})