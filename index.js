const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http").Server(app);
const io = require("socket.io")(http);
const serviceKey = require("./grovyo-89dc2-firebase-adminsdk-pwqju-41deeae515.json");
const admin = require("firebase-admin");
const mongoose = require("mongoose");
const User = require("./models/User");
const Topic = require("./models/topic");
const Community = require("./models/community");
const Admin = require("./models/admin");
const Ads = require("./models/Ads");
const Message = require("./models/message");
const Analytics = require("./models/Analytics");
const Advertiser = require("./models/Advertiser");
const Post = require("./models/post");
const Minio = require("minio");
const minioClient = new Minio.Client({
  endPoint: "minio.grovyo.xyz",

  useSSL: true,
  accessKey: "shreyansh379",
  secretKey: "shreyansh379",
});

//function to ge nerate a presignedurl of minio
async function generatePresignedUrl(bucketName, objectName, expiry = 604800) {
  try {
    const presignedUrl = await minioClient.presignedGetObject(
      bucketName,
      objectName,
      expiry
    );
    return presignedUrl;
  } catch (err) {
    console.error(err);
    throw new Error("Failed to generate presigned URL");
  }
}

require("dotenv").config();

app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(cookieParser());

//connect to DB
const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);
    mongoose.connect(process.env.DATABASE).then(() => {
      console.log("DB is connected");
    });
  } catch (err) {
    console.log(err);
  }
};
connectDB();

admin.initializeApp({
  credential: admin.credential.cert(serviceKey),
  databaseURL: "https://grovyo-89dc2.firebaseio.com",
});

// roomManager
let rooms = [];

function addUserToRoom(roomName, userId, socketId) {
  let room = rooms.find((r) => r.name === roomName);

  if (!room) {
    room = { name: roomName, users: [] };
    rooms.push(room);
  }

  room.users.push({ userId, socketId });

  console.log(`User ${userId} added to room ${roomName}`);
}

function removeUserFromRoom(roomName, userId) {
  const roomIndex = rooms.findIndex((r) => r.name === roomName);

  if (roomIndex !== -1) {
    const updatedRoom = { ...rooms[roomIndex] };
    const userIndex = updatedRoom.users.findIndex(
      (user) => user.userId === userId
    );

    if (userIndex !== -1) {
      updatedRoom.users.splice(userIndex, 1);
      rooms = [
        ...rooms.slice(0, roomIndex),
        updatedRoom,
        ...rooms.slice(roomIndex + 1),
      ];
      console.log(`User ${userId} removed from room ${roomName}`);
    }
  }
}

function removeUserFromAllRoomsBySocketId({ socketId }) {
  rooms.forEach((room, roomIndex) => {
    const userIndex = room.users.findIndex(
      (user) => user.socketId === socketId
    );

    if (userIndex !== -1) {
      room.users.splice(userIndex, 1);

      // If the room becomes empty after removing the user, remove the entire room
      if (room.users.length === 0) {
        rooms.splice(roomIndex, 1);
      }

      console.log(
        `User with socket ID ${socketId} removed from room ${room.name}`
      );
    }
  });
}

function removeUserFromRoomBySocketId(socketId) {
  rooms.forEach((room, roomIndex) => {
    const userIndex = room.users.findIndex(
      (user) => user.socketId === socketId
    );

    if (userIndex !== -1) {
      room.users.splice(userIndex, 1);

      // If the room becomes empty after removing the user, remove the entire room
      if (room.users.length === 0) {
        rooms.splice(roomIndex, 1);
      }

      console.log(
        `User with socket ID ${socketId} removed from room ${room.name}`
      );
    }
  });
}

function removeUserFromRoombysktid({ roomName, userId, socketId }) {
  const roomIndex = rooms.findIndex((r) => r.name === roomName);

  if (roomIndex !== -1) {
    const updatedRoom = { ...rooms[roomIndex] };
    const userIndex = updatedRoom.users.findIndex(
      (user) => user.socketId === socketId
    );

    if (userIndex !== -1) {
      updatedRoom.users.splice(userIndex, 1);
      rooms = [
        ...rooms.slice(0, roomIndex),
        updatedRoom,
        ...rooms.slice(roomIndex + 1),
      ];
      console.log(
        `User ${userId} and ${socketId} removed from room ${roomName}`
      );
    }
  }
}

function isUserInRoom({ roomName, userId }) {
  let room = rooms.find((r) => r.name === roomName);

  return room ? room.users.some((user) => user.userId === userId) : false;
}

function changeUserRoom(prevRoom, newRoom, userId) {
  const roomIndex = rooms.findIndex((r) => r.name === prevRoom);

  if (roomIndex !== -1) {
    const updatedRoom = { ...rooms[roomIndex] };
    const userIndex = updatedRoom.users.findIndex(
      (user) => user.userId === userId
    );

    if (userIndex !== -1) {
      updatedRoom.users.splice(userIndex, 1);
      rooms = [
        ...rooms.slice(0, roomIndex),
        updatedRoom,
        ...rooms.slice(roomIndex + 1),
      ];
      console.log(`User ${userId} removed from room ${prevRoom}`);
    }
  }

  let newRoomObj = rooms.find((r) => r.name === newRoom);

  if (!newRoomObj) {
    newRoomObj = { name: newRoom, users: [] };
    rooms.push(newRoomObj);
  }

  newRoomObj.users.push({ userId });

  console.log(`User ${userId} added to room ${newRoom}`);
}

function getRoomByName(roomName) {
  return rooms.find((r) => r.name === roomName);
}

//user
let users = [];

const addUser = ({ userId, socketId }) => {
  const existingUserIndex = users.findIndex((user) => user.userId === userId);

  if (existingUserIndex === -1) {
    users.push({ userId, socketId, isactive: true });
  } else {
    users[existingUserIndex].socketId = socketId;
    users[existingUserIndex].isactive = true;
  }
};

const updateUserLeaveTime = ({ socketId }) => {
  const userIndex = users.findIndex((user) => user.socketId === socketId);

  if (userIndex !== -1) {
    users[userIndex].isactive = new Date();
  }
};

const removeUser = ({ socketId }) => {
  const userIndexToRemove = users.findIndex(
    (user) => user.socketId === socketId
  );

  if (userIndexToRemove !== -1) {
    users.splice(userIndexToRemove, 1);
  }
};

const isUserthere = ({ userId }) => {
  return users.some((user) => user.userId === userId);
};

io.on("connection", (socket) => {
  socket.on("joinUser", ({ userId, roomId }) => {
    console.log("user joined", userId, socket.id);
    socket.join(roomId);
    addUser({ userId, socketId: socket.id });
    addUserToRoom(roomId, userId, socket.id);
  });

  //for marking active users
  socket.on("activeuser", async ({ userId, roomId }) => {
    socket.join(roomId);
    addUser({ userId, socketId: socket.id });
    addUserToRoom(roomId, userId, socket.id);
    console.log("active user:", userId);
    let today = new Date();

    let year = today.getFullYear();
    let month = String(today.getMonth() + 1).padStart(2, "0");
    let day = String(today.getDate()).padStart(2, "0");

    let formattedDate = `${day}/${month}/${year}`;

    const activity = await Admin.findOne({ date: formattedDate });
    if (activity) {
      //visitor count
      if (activity.users.includes(userId)) {
        await Admin.updateOne(
          { _id: activity._id },
          {
            $addToSet: {
              returning: userId,
            },
            $inc: {
              returningcount: 1,
            },
          }
        );
      } else {
        await Admin.updateOne(
          { _id: activity._id },
          {
            $addToSet: {
              users: userId,
            },
            $inc: {
              activeuser: 1,
            },
          }
        );
      }
    } else {
      const a = new Admin({
        date: formattedDate,
        activeuser: 1,
        users: userId,
      });
      await a.save();
    }
  });

  socket.on("isUserInRoom", ({ userId, roomId }) => {
    const isuser = isUserInRoom({ roomName: roomId, userId: userId });

    io.to(socket.id).emit("checkit", isuser);
  });

  socket.on("joinRoom", ({ roomId, userId }) => {
    socket.join(roomId);
    addUserToRoom(roomId, userId, socket.id);
    // const isthere = isUserthere({ socketId: socket.id });
    // console.log(isthere, "alive");

    //marking msgs as seen while entering the room
    let data = { id: userId };
    socket.to(roomId).emit("readconvs", data);

    socket.to(roomId).emit("online", true);
  });

  socket.on("switchRoom", async ({ prevRoom, newRoom, userId }) => {
    const usercheck = await isUserInRoom({
      roomName: prevRoom,
      userId: userId,
    });
    if (usercheck) {
      removeUserFromRoom({ prevRoom, userId });
      socket.leave(prevRoom);
      socket.join(newRoom);
      addUserToRoom(newRoom, userId, socket.id);
    } else {
      socket.leave(prevRoom);
      socket.join(newRoom);
      addUserToRoom(newRoom, userId, socket.id);
    }
    console.log("switched", usercheck, prevRoom, "prev", newRoom, "new");
  });

  socket.on("chatMessage", async ({ roomId, userId, data }) => {
    const usercheck = await isUserInRoom({ roomName: roomId, userId: userId });
    if (usercheck) {
      console.log("sent", roomId);
      socket.join(roomId);
      socket.to(roomId).emit("ms", data);
      savemsg(data);
      sendNotifcation(data);
    } else {
      console.log("joined and sent");
      socket.join(roomId);
      addUserToRoom(roomId, userId, socket.id);
      socket.to(roomId).emit("ms", data);
      savemsg(data);
      sendNotifcation(data);
    }
  });
  socket.on("singleChatMessage", async ({ roomId, userId, data, ext }) => {
    const usercheck = await isUserInRoom({ roomName: roomId, userId: userId });
    const rec = await User.findById(data?.reciever);
    const sender = await User.findById(data?.sender_id);

    let isblocked = false;
    rec.blockedpeople.forEach((p) => {
      if (p?.id?.toString() === sender._id.toString()) {
        isblocked = true;
      }
    });
    sender.blockedpeople.forEach((p) => {
      if (p?.id?.toString() === rec._id.toString()) {
        isblocked = true;
      }
    });
    SaveChats(data);
    if (isblocked === false) {
      if (usercheck) {
        console.log("sent to", userId);
        socket.join(roomId);
        socket.to(roomId).emit("ms", data);
        socket.to(userId).emit("allchats", ext);

        sendNoti(data);
      } else {
        console.log("joined and sent");
        socket.join(roomId);
        addUserToRoom(roomId, userId, socket.id);
        socket.to(roomId).emit("ms", data);
        socket.to(userId).emit("allchats", ext);

        sendNoti(data);
      }
    }
  });

  //typing status convsersations
  socket.on("typing", async ({ roomId, id, userId, status }) => {
    let data = { id: userId, status, convId: roomId };

    socket.join(userId); //person who is typing
    socket.to(roomId).emit("istyping", data);
    socket.to(id).emit("istypingext", data);
  });
  //deleting for everyone conversations
  socket.on("deleteforeveryone", async ({ roomId, userId, data }) => {
    socket.join(roomId);
    socket.to(roomId).emit("deleted", data);
    socket.to(userId).emit("deletedext", data);
  });

  //for instant read msg
  socket.on("readnow", async ({ userId, roomId, mesId }) => {
    let data = { id: userId, mesId };
    socket.to(roomId).emit("readconvs", data);
    console.log("read", data?.id);
  });

  //read success callback
  socket.on("successreadnow", async ({ userId, roomId, mesId }) => {
    console.log(userId, roomId, mesId, "success read");
    if (mesId) {
      await Message.updateOne(
        { mesId: mesId },
        { $addToSet: { readby: userId } }
      );
    }
  });

  //recording views
  socket.on("emitviews", async ({ postId }) => {
    try {
      const post = await Post.findById(postId);
      if (post) {
        await Post.updateOne({ _id: post._id }, { $inc: { views: 1 } });
      } else {
        console.log("error inc views");
      }
    } catch (e) {
      console.log(e);
    }
  });

  //rec ads
  socket.on("adviews", async ({ postId, imp, view, click, userId, inside }) => {
    try {
      const post = await Post.findById(postId);
      if (post) {
        let today = new Date();

        let year = today.getFullYear();
        let month = String(today.getMonth() + 1).padStart(2, "0");
        let day = String(today.getDate()).padStart(2, "0");

        let formattedDate = `${day}/${month}/${year}`;

        const latestana = await Analytics.findOne({
          date: formattedDate,
          id: post.promoid,
        });

        const ad = await Ads.findById(post.promoid);
        const user = await User.findById(userId);
        const advertiser = await Advertiser.findById(ad.advertiserid);

        if (
          ad &&
          new Date(ad?.enddate) >= new Date() &&
          ad.status !== "stopped" &&
          advertiser
        ) {
          //calulating price
          function calculateAdRate(ad) {
            const costs = {
              gender: { male: 3, female: 2 },
              audience: {
                Sales: 9,
                Awareness: 5,
                Clicks: 10,
                Views: 4,
                Downloads: 8,
              },
              type: { banner: 3, skipable: 7, "non-skipable": 9, infeed: 5 },
            };

            let adRate = 0;

            if (ad && ad.type && costs.type.hasOwnProperty(ad.type)) {
              adRate += costs.type[ad.type];

              if (ad.gender && costs.gender.hasOwnProperty(ad.gender)) {
                adRate += costs.gender[ad.gender] || 5;
              }

              if (ad.audience && costs.audience.hasOwnProperty(ad.audience)) {
                adRate += costs.audience[ad.audience];
              }

              // if (ad.totalbudget) {
              //   adRate *= parseInt(ad.totalbudget);
              // }
            }

            return adRate;
          }

          const ad1 = {
            type: ad.type,
            gender: user?.gender,
            audience: ad.goal,
            totalbudget: ad?.totalbudget,
          };

          const adRate = calculateAdRate(ad1);

          if (
            parseInt(adRate) > parseInt(advertiser.currentbalance) ||
            parseInt(ad.totalbudget) < parseInt(ad.totalspent)
          ) {
            await Ads.updateOne(
              { _id: ad._id },
              { $set: { status: "stopped", stopreason: "Low Balance" } }
            );
            await Post.updateOne({ _id: post._id }, { $set: { kind: "post" } });
          } else {
            //updating ad stats
            await Ads.updateOne(
              { _id: ad._id },
              {
                $inc: {
                  totalspent: adRate,
                  views: view ? view : 0,
                  clicks: click ? click : 0,
                  impressions: imp ? imp : 0,
                  cpc: click / adRate || 0,
                },
              }
            );

            if (latestana) {
              await Analytics.updateOne(
                { _id: latestana._id },
                {
                  $inc: {
                    impressions: imp ? imp : 0,
                    views: view ? view : 0,
                    cpc: click / adRate || 0,
                    cost: adRate,
                    click: click ? click : 0,
                  },
                }
              );
            } else {
              const an = new Analytics({
                date: formattedDate,
                id: post.promoid,
                impressions: imp ? imp : 0,
                views: view ? view : 0,
                cpc: click / adRate || 0,
                cost: adRate,
                click: click ? click : 0,
              });
              await an.save();
            }
            console.log(adRate);
            //updating creator stats
            const com = await Community.findById(post.community);
            if (com) {
              if (com.ismonetized === true && inside) {
                //giving 90% to creator
                let moneytocreator = (adRate / 100) * 90;
                let moneytocompany = (adRate / 100) * 10;

                let earned = { how: "Ads", when: Date.now() };
                await User.updateOne(
                  { _id: com.creator },
                  {
                    $inc: { adsearning: moneytocreator },
                    $push: { earningtype: earned },
                  }
                );

                let earning = {
                  how: "Ads",
                  amount: moneytocompany,
                  when: Date.now(),
                  id: ad._id,
                };
                await Admin.updateOne(
                  { date: formattedDate },
                  {
                    $inc: { todayearning: moneytocompany },
                    $push: { earningtype: earning },
                  }
                );
              } else {
                let earning = {
                  how: "Ads",
                  amount: adRate,
                  when: Date.now(),
                  id: ad._id,
                };
                await Admin.updateOne(
                  { date: formattedDate },
                  {
                    $inc: { todayearning: adRate },
                    $push: { earningtype: earning },
                  }
                );
              }
            }

            let amtspt = {
              date: Date.now(),
              amount: adRate,
            };
            //deducting the amount from the advertiser
            await Advertiser.updateOne(
              { _id: ad.advertiserid },
              {
                $inc: { currentbalance: -adRate },
                $push: { amountspent: amtspt },
              }
            );
          }

          await Post.updateOne({ _id: post._id }, { $inc: { views: 1 } });
        }
      } else {
        console.log("error inc views");
      }
    } catch (e) {
      console.log(e);
    }
  });

  //inc share count
  socket.on("incshare", async ({ postId }) => {
    try {
      const post = await Post.findById(postId);
      if (post) {
        await Post.updateOne({ _id: post._id }, { $inc: { sharescount: 1 } });
      } else {
        console.log("error inc shares");
      }
    } catch (e) {
      console.log(e);
    }
  });

  socket.on("singleChatContent", async ({ roomId, userId, data, ext }) => {
    const usercheck = await isUserInRoom({ roomName: roomId, userId: userId });

    const rec = await User.findById(data?.reciever);
    const sender = await User.findById(data?.sender_id);

    let isblocked = false;
    rec.blockedpeople.forEach((p) => {
      if (p?.id?.toString() === sender._id.toString()) {
        isblocked = true;
      }
    });
    sender.blockedpeople.forEach((p) => {
      if (p?.id?.toString() === rec._id.toString()) {
        isblocked = true;
      }
    });
    if (isblocked === false) {
      if (usercheck) {
        console.log("sent", roomId);
        socket.join(roomId);
        socket.to(roomId).emit("ms", data);
        socket.to(userId).emit("allchats", ext);
        sendNoti(data);
      } else {
        console.log("joined and sent");
        socket.join(roomId);
        addUserToRoom(roomId, userId, socket.id);
        socket.to(roomId).emit("ms", data);
        socket.to(userId).emit("allchats", ext);
        sendNoti(data);
      }
    }
  });

  socket.on("blockperson", ({ roomId, userId, action }) => {
    let data = { id: userId, action };
    console.log(roomId, userId, "block");
    socket.to(roomId).emit("afterblock", data);
  });

  socket.on("leaveRoom", ({ roomId, userId }) => {
    socket.leave(roomId);
    removeUserFromRoom(roomId, userId);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
    updateUserLeaveTime({ socketId: socket.id });
    removeUserFromAllRoomsBySocketId({ socketId: socket.id });
  });
});

http.listen(4400, function () {
  console.log("Rooms on 4400");
});

const markoffline = async ({ uid }) => {
  await Topic.updateOne(
    { _id: "64ecca149c8418279d97fbe2" },
    { $push: { offline: "64a68d4e736586cadb47dcc4" } }
  );
  console.log("ran");
};

//msg and notificaiton send to chats
const sendchatmsg = async ({ data, user }) => {
  try {
    const sender = await User.findById(data?.sender_id);
    const reciever = await User.findById(data?.reciever);
    let isblocked = false;

    if (reciever && sender) {
      const senderblocks =
        sender?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const recblocks =
        reciever?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const isBlockedbysender = senderblocks.some((blockedId) => {
        if (blockedId === reciever?._id?.toString()) {
          isblocked = true;
        }
      });
      const isBlockedbyrec = recblocks.some((blockedId) => {
        if (blockedId === sender?._id?.toString()) {
          isblocked = true;
        }
      });
    }

    if (isblocked === false) {
      console.log(user, data);
      io.to(user?.socketid).emit("data", data);
      SaveChats(data);
      sendNoti(data);
    } else {
      console.log("blocked");
    }
  } catch (e) {
    console.log(e);
  }
};

//send expression notification
//send notification to people chats
const sendNotiExp = async ({ data, user }) => {
  try {
    const sender = await User.findById(data?.sender_id);
    const reciever = await User.findById(data?.reciever);
    let isblocked = false;

    if (reciever && sender) {
      const senderblocks =
        sender?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const recblocks =
        reciever?.blockedpeople?.map((item) => item.id?.toString()) || [];
      const isBlockedbysender = senderblocks.some((blockedId) => {
        if (blockedId === reciever?._id?.toString()) {
          isblocked = true;
        }
      });
      const isBlockedbyrec = recblocks.some((blockedId) => {
        if (blockedId === sender?._id?.toString()) {
          isblocked = true;
        }
      });
    }

    if (isblocked === false) {
      if (user) {
        io.to(user?.socketid).emit("expressions", data);
        const message = {
          notification: {
            title: user?.fullname,
            body: `Reacted ${data?.exp}`,
          },
          data: {
            screen: "Chats",
            sender_fullname: `${user?.fullname}`,
            sender_id: `${user?._id}`,
            text: `Reacted ${data?.exp}`,
            convId: `${data?.convId}`,
            createdAt: `${data?.createdAt}`,
          },
          token: user?.notificationtoken,
        };
        await admin
          .messaging()
          .send(message)
          .then((response) => {
            console.log("Successfully sent message");
          })
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
    } else {
      console.log("blocked");
    }
  } catch (e) {
    console.log(e);
  }
};

//save chat msgs
const SaveChats = async (data) => {
  try {
    const message = new Message({
      text: data?.text,
      sender: data?.sender_id,
      conversationId: data?.convId,
      typ: data?.typ,
      mesId: data?.mesId,
      reply: data?.reply,
      dissapear: data?.dissapear,
      isread: data?.isread,
      sequence: data?.sequence,
      timestamp: data?.timestamp,
      replyId: data?.replyId,
    });
    await message.save();
    console.log("Saved");

    // await User.updateOne(
    //   { _id: data?.reciever },
    //   { $push: { mesIds: data?.mesId } }
    // );
    // await User.updateOne(
    //   { _id: data?.sender_id },
    //   { $push: { mesIds: data?.mesId } }
    // );
  } catch (e) {
    console.log(e);
  }
};

//community msgs
const savemsg = async (data) => {
  try {
    const message = new Message({
      text: data?.text,
      sender: data?.sender_id,
      topicId: data?.sendtopicId,
      typ: data?.typ,
      mesId: data?.mesId,
      reply: data?.reply,
      dissapear: data?.dissapear,
      comId: data?.comId,
      sequence: data?.sequence,
      timestamp: data?.timestamp,
    });
    await message.save();
    console.log("saved");
  } catch (e) {
    console.log(e, "notsaved");
  }
};

//send notification to people chats
const sendNoti = async (data) => {
  try {
    const user = await User.findById(data?.reciever);
    const sender = await User.findById(data?.sender_id);
    const senderpic = process.env.URL + sender.profilepic;
    if (user) {
      //checking if the rec has conv after deletion or not
      const rec = await User.findById(data?.reciever);
      if (rec?.conversations.includes(data?.convId)) {
      } else {
        await User.updateOne(
          { _id: rec._id },
          {
            $push: {
              conversations: data?.convId,
            },
          }
        );
      }
      if (!rec?.muted?.includes(data?.convId)) {
        const message = {
          notification: {
            title: data?.sender_fullname,
            body:
              data?.typ === "image"
                ? "Image"
                : data?.typ === "video"
                ? "Video"
                : data?.typ === "doc"
                ? "Document"
                : data?.typ === "glimpse"
                ? "Glimpse"
                : data?.text,
          },
          data: {
            screen: "Conversation",
            sender_fullname: `${data?.sender_fullname}`,
            sender_id: `${data?.sender_id}`,
            text:
              data?.type === "image"
                ? "Image"
                : data?.typ === "video"
                ? "Video"
                : data?.typ === "doc"
                ? "Document"
                : data?.typ === "glimpse"
                ? "Glimpse"
                : `${data?.text}`,
            convId: `${data?.convId}`,
            createdAt: `${data?.timestamp}`,
            mesId: `${data?.mesId}`,
            typ: `${data?.typ}`,
            senderuname: `${sender?.username}`,
            senderverification: `${sender.isverified}`,
            senderpic: `${senderpic}`,
            reciever_fullname: `${user.fullname}`,
            reciever_username: `${user.username}`,
            reciever_isverified: `${user.isverified}`,
            reciever_pic: `${data?.reciever_pic}`,
            reciever_id: `${user._id}`,
          },
          token: user?.notificationtoken,
        };
        await admin
          .messaging()
          .send(message)
          .then((response) => {
            console.log("Successfully sent message");
          })
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
    }
  } catch (e) {
    console.log(e);
  }
};

//send notification to multiple people in topics only
const sendNotifcation = async (data) => {
  try {
    const topic = await Topic.findById(data?.sendtopicId).populate({
      path: "notifications.id",
      model: "User",
      select: "notificationtoken",
    });

    const subscribedTokens = topic?.notifications?.map((t) =>
      t?.muted === true ? null : t.id.notificationtoken
    );
    let tokens = [];

    if (Array.isArray(subscribedTokens) && subscribedTokens.length > 0) {
      for (const token of subscribedTokens) {
        try {
          if (token !== null) {
            tokens.push(token);
          }
        } catch (error) {
          console.log(
            `Error sending notification to token ${token}:`,
            error.message
          );
        }
      }
    } else {
      console.warn("No valid tokens to send notifications.");
    }

    if (tokens?.length > 0) {
      const message = {
        notification: {
          title: data?.comtitle,
          body: `${data?.sender_fullname}: ${data?.text}`,
        },
        data: {
          screen: "ComChat",
          sender_fullname: `${data?.sender_fullname}`,
          sender_id: `${data?.sender_id}`,
          text: `${data?.text}`,
          topicId: `${data?.topicId}`,
          createdAt: `${data?.timestamp}`,
          mesId: `${data?.mesId}`,
          typ: `${data?.typ}`,
          comId: `${data?.comId}`,
          props: `${data?.props}`,
          sendtopicId: `${data?.sendtopicId}`,
          postId: `${data?.postId}`,
        },
        tokens: tokens,
      };

      await admin
        .messaging()
        .sendEachForMulticast(message)
        .then((response) => {
          console.log("Successfully sent message");
        })
        .catch((error) => {
          console.log("Error sending message:", error);
        });
    } else {
      console.log("no notifications");
    }
  } catch (e) {
    console.log(e);
  }
};

// await axios.post(`${API}/newmessage/64d7cf927f5cb52c36f8b914`, {
//   topicId: ci,
//   sender: id,
//   text: message,
//   typ: 'message',
//   mesId: rid,
//   comId: comId,
//   dissapear: false,
// });
