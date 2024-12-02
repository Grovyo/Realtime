const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http").Server(app);
const io = require("socket.io")(http);
const serviceKey = require("./grovyo-89dc2-ff6415ff18de.json");
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
const Deluser = require("./models/deluser");
const fs = require("fs");
const path = require("path");
const PrositeAnalytics = require("./models/PrositeAnalytics");
const moment = require("moment");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
require("dotenv").config();

//middleware
app.use(require("express-status-monitor")());
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

app.get("/", (req, res) => {
  res.status(200).json({
    succes: true,
    messages: "all is good and healthy",
  });
});

function addUserToRoom(roomName, userId, socketId) {
  try {
    let room = rooms.find((r) => r.name === roomName);

    if (!room) {
      room = { name: roomName, users: [] };
      rooms.push(room);
    }

    room.users.push({ userId, socketId });

    console.log(`User ${userId} added to room ${roomName}`);
  } catch (error) {
    console.error("Error in addUserToRoom:", error);
  }
}

function removeUserFromRoom(roomName, userId) {
  try {
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
  } catch (error) {
    console.error("Error in removeUserFromRoom:", error);
  }
}

function removeUserFromAllRoomsBySocketId({ socketId }) {
  try {
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
  } catch (error) {
    console.error("Error in removeUserFromAllRoomsBySocketId:", error);
  }
}

function isUserInRoom({ roomName, userId }) {
  try {
    const room = rooms.find((r) => r.name === roomName);
    return room ? room.users.some((user) => user.userId === userId) : false;
  } catch (error) {
    console.error("Error in isUserInRoom:", error);
    return false;
  }
}

let users = [];

const addUser = ({ userId, socketId }) => {
  try {
    const existingUserIndex = users.findIndex((user) => user.userId === userId);

    if (existingUserIndex === -1) {
      users.push({ userId, socketId, isactive: true });
    } else {
      users[existingUserIndex].socketId = socketId;
      users[existingUserIndex].isactive = true;
    }
  } catch (error) {
    console.error("Error in addUser:", error);
  }
};

const updateUserLeaveTime = ({ socketId }) => {
  try {
    const userIndex = users.findIndex((user) => user.socketId === socketId);

    if (userIndex !== -1) {
      users[userIndex].isactive = new Date();
    }
  } catch (error) {
    console.error("Error in updateUserLeaveTime:", error);
  }
};

const generateRtcToken = function ({ convId, id, isHost }) {
  try {
    const appID = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + 3600;
    const channelName = convId;
    const role = isHost ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    console.log("New token Generated for", role);

    const key = RtcTokenBuilder.buildTokenWithUid(
      appID,
      appCertificate,
      channelName,
      id,
      role,
      privilegeExpiredTs
    );

    return key;
  } catch (error) {
    console.error("Error in generateRtcToken:", error);
    return null; // Returning null as a fallback if an error occurs
  }
};

io.use(async (socket, next) => {
  try {
    const sessionID = socket.handshake.auth.id;
    const type = socket.handshake.auth.type;
    const skipMiddleware = socket.handshake.auth.skipMiddleware;

    // If skipMiddleware is true, allow the connection without running the full middleware
    if (skipMiddleware) {
      console.log("Middleware skipped for socket:", socket.id);
      return next();
    }

    if (sessionID) {
      socket.join(sessionID);

      if (type === "mobile") {
        const user = await User.findById(sessionID);

        if (user && user.notificationtoken) {
          // Awake notification
          const data = {
            id: user._id,
            notificationtoken: user.notificationtoken,
          };
          console.log("Awake notification data:", data);
        }
      }

      console.log("Middleware ran for", sessionID, "in", type);
      return next();
    }

    return next(new Error("Authentication failed: Missing sessionID"));
  } catch (error) {
    console.error("Error in socket middleware:", error);
    return next(new Error("Internal server error"));
  }
});

io.on("connection", (socket) => {
  socket.on("joinUser", ({ userId, roomId }) => {
    try {
      console.log("user joined", userId, socket.id);
      socket.join(roomId);
      addUser({ userId, socketId: socket.id });
      addUserToRoom(roomId, userId, socket.id);
    } catch (error) {
      console.error("Error in joinUser:", error.message);
    }
  });

  socket.on("check-late", async (data) => {
    try {
      const finalid = data;
      const allmsgs = await Message.find({
        issent: false,
        rec: data,
        readby: { $nin: [data] },
      })
        .populate("sender", "profilepic fullname username isverified")
        .populate("rec", "profilepic fullname username isverified")
        .sort({ createdAt: -1 })
        .limit(5);

      if (allmsgs?.length > 0) {
        for (let i = 0; i < allmsgs.length; i++) {
          let data = {
            sender_fullname: allmsgs[i].sender.fullname,
            sender_id: allmsgs[i].sender._id,
            text: allmsgs[i].text,
            createdAt: allmsgs[i].createdAt,
            timestamp: allmsgs[i].timestamp,
            mesId: allmsgs[i].mesId,
            typ: allmsgs[i].typ,
            convId: allmsgs[i].conversationId,
            isread: allmsgs[i].isread,
            sender: { _id: allmsgs[i].sender },
            readby: allmsgs[i].readby,
          };
          let ext = {
            convid: allmsgs[i].conversationId,
            fullname: allmsgs[i].sender.fullname,
            id: allmsgs[i].sender._id,
            isverified: allmsgs[i].sender.isverified,
            msgs: [
              {
                sender: allmsgs[i].sender._id,
                conversationId: allmsgs[i].conversationId,
                isread: allmsgs[i].isread,
                text: allmsgs[i].text,
                createdAt: allmsgs[i].createdAt,
                timestamp: allmsgs[i].timestamp,
                mesId: allmsgs[i].mesId,
                typ: allmsgs[i].typ,
              },
            ],
            pic: process.env.URL + allmsgs[i].sender.profilepic,
            username: allmsgs[i].sender.username,
            readby: allmsgs[i].readby,
          };

          let final = { data, ext };

          io.to(finalid).emit("outer-private", final);

          await Message.updateOne(
            { _id: allmsgs[i]._id },
            { $set: { issent: true } }
          );
        }
      }
    } catch (error) {
      console.error("Error in check-late:", error.message);
    }
  });

  socket.on("activeuser", async ({ userId, roomId }) => {
    try {
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
        if (activity.users.includes(userId)) {
          await Admin.updateOne(
            { _id: activity._id },
            {
              $addToSet: { returning: userId },
              $inc: { returningcount: 1 },
            }
          );
        } else {
          await Admin.updateOne(
            { _id: activity._id },
            {
              $addToSet: { users: userId },
              $inc: { activeuser: 1 },
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
    } catch (error) {
      console.error("Error in activeuser:", error.message);
    }
  });

  socket.on("isUserInRoom", ({ userId, roomId }) => {
    try {
      const isuser = isUserInRoom({ roomName: roomId, userId: userId });
      io.to(socket.id).emit("checkit", isuser);
    } catch (error) {
      console.error("Error in isUserInRoom:", error.message);
    }
  });

  socket.on("joinRoom", ({ roomId, userId }) => {
    try {
      socket.join(roomId);
      addUserToRoom(roomId, userId, socket.id);

      let data = { id: userId };
      socket.to(roomId).emit("readconvs", data);
      socket.to(roomId).emit("online", true);
    } catch (error) {
      console.error("Error in joinRoom:", error.message);
    }
  });

  socket.on("switchRoom", async ({ prevRoom, newRoom, userId }) => {
    try {
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
    } catch (error) {
      console.error("Error in switchRoom:", error.message);
    }
  });

  socket.on("chatMessage", async ({ roomId, userId, data }) => {
    try {
      const usercheck = await isUserInRoom({
        roomName: roomId,
        userId: userId,
      });

      if (usercheck) {
        console.log("sent", roomId);
        socket.join(roomId);
        socket.to(roomId).emit("ms", data);
        socket.to(roomId).to(userId).emit("outer-ms", data);
        savemsg(data);
        sendNotifcation(data);
      } else {
        console.log("joined and sent");
        socket.join(roomId);
        addUserToRoom(roomId, userId, socket.id);
        socket.to(roomId).emit("ms", data);
        socket.to(roomId).to(userId).emit("outer-ms", data);
        savemsg(data);
        sendNotifcation(data);
      }
    } catch (error) {
      console.error("Error in chatMessage:", error.message);
    }
  });

  socket.on("chatMessagecontent", async ({ roomId, userId, data }) => {
    try {
      const usercheck = await isUserInRoom({
        roomName: roomId,
        userId: userId,
      });

      if (usercheck) {
        console.log("sent", roomId);
        socket.join(roomId);
        socket.to(roomId).emit("ms", data);
        socket.to(roomId).to(userId).emit("outer-ms", data);
        sendNotifcation(data);
      } else {
        console.log("joined and sent");
        socket.join(roomId);
        addUserToRoom(roomId, userId, socket.id);
        socket.to(roomId).emit("ms", data);
        socket.to(roomId).to(userId).emit("outer-ms", data);
        sendNotifcation(data);
      }
    } catch (error) {
      console.error("Error in chatMessagecontent:", error.message);
    }
  });

  //for private messages
  socket.on("singleChatMessage", async ({ roomId, userId, data, ext }) => {
    try {
      const rec = await User.findById(data?.reciever);
      const sender = await User.findById(data?.sender_id);

      if (!rec || !sender) {
        console.error("Receiver or sender not found");
        return;
      }

      let isBlocked =
        rec.blockedpeople.some(
          (p) => p?.id?.toString() === sender._id.toString()
        ) ||
        sender.blockedpeople.some(
          (p) => p?.id?.toString() === rec._id.toString()
        );

      if (!isBlocked) {
        await SaveChats(data);
        const final = { data, ext };

        socket.to(roomId).to(userId).emit("reads", data);
        socket.to(roomId).to(userId).emit("outer-private", final);

        console.log(data, roomId, userId, "message");
        sendNoti(data);
      } else {
        console.log("Message blocked due to user restrictions");
      }
    } catch (error) {
      console.error("Error in singleChatMessage:", error.message);
    }
  });

  socket.on("singleChatContent", async ({ roomId, userId, data, ext }) => {
    try {
      const rec = await User.findById(data?.reciever);
      const sender = await User.findById(data?.sender_id);

      if (!rec || !sender) {
        console.error("Receiver or sender not found");
        return;
      }

      let isBlocked =
        rec.blockedpeople.some(
          (p) => p?.id?.toString() === sender._id.toString()
        ) ||
        sender.blockedpeople.some(
          (p) => p?.id?.toString() === rec._id.toString()
        );

      if (!isBlocked) {
        const final = { data, ext };

        socket.to(roomId).to(userId).emit("reads", data);
        socket.to(roomId).to(userId).emit("outer-private", final);

        console.log(data, roomId, userId, "Media");
        sendNoti(data);
      } else {
        console.log("Content blocked due to user restrictions");
      }
    } catch (error) {
      console.error("Error in singleChatContent:", error.message);
    }
  });

  // Typing status for conversations
  socket.on("typing", async ({ roomId, id, userId, status }) => {
    try {
      const data = { id: userId, status, convId: roomId };

      console.log("typed by " + userId);
      socket.to(roomId).emit("istyping", data);
      socket.to(id).to(userId).emit("istypingext", data);
      socket.to(roomId).to(id).to(userId).emit("outer-private-typing", data);
    } catch (error) {
      console.error("Error in typing:", error.message);
    }
  });

  // Deleting messages for everyone in conversations
  socket.on("deleteforeveryone", async ({ roomId, rec, userId, data }) => {
    try {
      console.log("Deleted by " + userId);

      socket.to(roomId).emit("deleted", data);
      socket.to(userId).to(rec).emit("deletedext", data);
      socket.to(roomId).to(userId).emit("outer-private-delete", data);
    } catch (error) {
      console.error("Error in deleteforeveryone:", error.message);
    }
  });

  //for instant read msg
  socket.on("readnowupper", async ({ userId, roomId, mesId }) => {
    try {
      let data = { id: userId, mesId };
      console.log(userId, roomId, mesId, "success read");
      if (mesId) {
        await Message.updateOne(
          { mesId: mesId },
          { $addToSet: { readby: [userId, roomId] }, $set: { issent: true } }
        );
      }
      console.log("read", data?.id);
    } catch (error) {
      console.log(error);
    }
  });

  //for reading normally
  socket.on("readnow", async ({ userId, roomId, mesId }) => {
    try {
      let data = { id: userId, mesId };
      io.to(userId).to(roomId).emit("readconvs", data);
      console.log("read", data?.id);
    } catch (error) {
      console.log(error);
    }
  });

  //read success callback
  socket.on("successreadnow", async ({ userId, roomId, mesId }) => {
    try {
      console.log(userId, roomId, mesId, "success read");
      if (mesId) {
        await Message.updateOne(
          { mesId: mesId },
          { $addToSet: { readby: userId, roomId }, $set: { issent: true } }
        );
      }
    } catch (error) {
      console.log(error);
    }
  });

  //for braodcasting poll happened
  socket.on("polled", async ({ id, postId, optionId, comId }) => {
    try {
      const post = await Post.findById(postId);
      const user = await User.findById(id);
      const community = await Community.findById(comId);
      if (post && user && community) {
        //sending notification to whole community
        sendNotifcationCommunity({ id, postId, optionId, comId });
      }
    } catch (e) {
      console.log(e, "poll unsucessfull");
    }
  });

  //recording views
  socket.on("emitviews", async ({ postId }) => {
    try {
      const post = await Post.findById(postId);
      if (post) {
        await Post.updateOne({ _id: post._id }, { $inc: { views: 3 } });
        console.log("post View");
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
        console.log(post.promoid);
        const ad = await Ads.findById(post.promoid);
        const user = await User.findById(userId);
        const advertiser = await Advertiser.findById(ad.advertiserid);

        if (
          ad &&
          (ad?.enddate === "Not Selected"
            ? true
            : new Date(ad?.enddate) >= new Date()) &&
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
                //giving 80% to creator
                let moneytocreator = (adRate / 100) * 80;
                let moneytocompany = (adRate / 100) * 20;

                let earned = { how: "Ads", when: Date.now() };
                await User.updateOne(
                  { _id: com.creator },
                  {
                    $inc: { adsearning: moneytocreator },
                    $push: { earningtype: earned },
                  }
                );
                const getrandom = Math.round(Math.random());
                if (getrandom === 0) {
                  await Community.updateOne(
                    { _id: com._id },
                    { $inc: { cpm: moneytocreator } }
                  );
                } else {
                  await Community.updateOne(
                    { _id: com._id },
                    { $inc: { cpc: moneytocreator } }
                  );
                }

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

  socket.on("blockperson", ({ roomId, rec, userId, action }) => {
    try {
      let data = { id: userId, action };
      console.log(roomId, userId, "block");
      socket.to(roomId).to(rec).emit("afterblock", data);
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("leaveRoom", ({ roomId, userId }) => {
    try {
      socket.leave(roomId);
      removeUserFromRoom(roomId, userId);
    } catch (error) {
      console.log(error);
    }
  });

  //video calling
  socket.on("room:join", (data) => {
    try {
      const { room } = data;
      console.log(room);
      io.to(room).emit("user:joined", { id: socket.id });
      socket.join(room);
      io.to(socket.id).emit("room:join", data);
    } catch (error) {
      console.log(error);
    }
  });

  //call
  socket.on("call:start", ({ id, hisid, convId }) => {
    const sendcall = async ({ id, hisid }) => {
      try {
        const user = await User.findById(id);
        const rec = await User.findById(hisid);
        if (rec.notificationtoken) {
          let dp = process.env.URL + user.profilepic;

          const timestamp = `${new Date()}`;
          const msg = {
            notification: { title: `${user?.fullname}`, body: "Incoming Call" },
            data: {
              screen: "OngoingCall",
              type: "incoming",
              name: `${user?.fullname}`,
              sender_id: `${user._id}`,
              text: `incoming call from ${user.fullname}`,
              recid: `${rec._id}`, //rec id
              callconvId: `${convId}`,
              timestamp: `${timestamp}`,
              dp,
              // offer: JSON.stringify(offer),
            },
            token: rec?.notificationtoken,
          };

          await admin
            .messaging()
            .send(msg)
            .then((response) => {
              console.log("Successfully sent call Alert");
              io.to(id).emit("isringing", true);
            })
            .catch((error) => {
              console.log("Error sending message:", error);
            });
        }
      } catch (e) {
        console.log(e);
      }
    };
    sendcall({ id, hisid });
  });

  socket.on("user:accept", ({ to }) => {
    io.to(to).emit("user:accept:final", {});
  });
  socket.on("send:offer", ({ to, offer }) => {
    socket.to(to).emit("send:ans", { offer });
  });
  socket.on("send:newans", ({ to, ans }) => {
    socket.to(to).emit("set:ans", { ans });
  });

  socket.on("qr-scan", ({ id, string }) => {
    try {
      io.to(string).emit("qr-rec", id);
    } catch (error) {
      console.log(error);
    }
  });
  //end

  socket.on("user:call", ({ to, offer }) => {
    console.log("Calling", to);
    io.to(to).emit("incoming:call", { from: socket.id, offer });
  });

  socket.on("call:picked", ({ check, id }) => {
    if (check) {
      console.log(check, id);
      io.to(id).emit("call:picked:final", { from: socket.id });
    }
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:nego:needed", ({ to, offer }) => {
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });

  socket.on("peer:nego:done", ({ to, ans }) => {
    console.log("peer:nego:done", ans);
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });

  socket.on("call:end", ({ hisid }) => {
    console.log("ending call with", hisid);
    io.to(hisid).emit("call:end:final", { end: true });
  });

  socket.on("decline:call", ({ to }) => {
    io.to(to).emit("decline:call:final", { end: true });
  });

  //agora
  socket.on("generate:token", async ({ to, convId, id, isHost }) => {
    try {
      let token = generateRtcToken({ convId, id, isHost });
      io.to(to).emit("gen:final", token);
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("currentloc", async (data) => {
    const { id, lat, long } = data;
    const user = await Deluser.findById(id);
    if (user && lat && long) {
      console.log(`Got loc for ${id} -  ${(lat, long)}`);
      user.currentlocation.latitude = lat;
      user.currentlocation.longitude = long;
      await user.save();
    }
  });

  //start delivery
  socket.on("loc-data", async (data) => {
    const { id, start, end } = data;

    console.log(`starting and ending Coords ${id} - ${start} ${end}`);
  });
  //track delivery
  socket.on("mycoords", async (data) => {
    const { id, lat, long } = data;

    if (lat && long) {
      console.log(`Current Coords ${id} - ${lat} ${long}`);
    }
  });

  socket.on("locstart", async (data) => {
    console.log(data);
  });

  let fileStream;
  socket.on("upload-start", async (message) => {
    try {
      const data = JSON.parse(message);
      const { chunk, fileName, offset, totalSize } = data;

      if (offset === 0) {
        // Create a writable stream for the new file
        fileStream = fs.createWriteStream(
          path.join(__dirname, "uploads", fileName)
        );
      }

      // Write the chunk to the file
      const buffer = Buffer.from(chunk, "base64");
      fileStream.write(buffer, () => {
        const progress = Math.round(
          ((offset + buffer.length) / totalSize) * 100
        );
        // ws.send(JSON.stringify({ progress }));
        console.log(progress);
        if (offset + buffer.length >= totalSize) {
          fileStream.end();
          // ws.send(JSON.stringify({ progress: 100, message: "Upload complete" }));
          console.log("Complete");
        }
      });
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("prositeCount", async ({ prositeUserId, userId }) => {
    try {
      const user = await User.findById(userId).select("gender DOB address");
      if (!user) return;

      const gender = user?.gender?.toLowerCase();
      const state = user?.address?.state;
      const age = user?.DOB
        ? moment().diff(moment(user.DOB, "DD/MM/YYYY"), "years")
        : null;
      console.log(gender, state, age, "gender, state, age");

      // Find or create prositeAnalytics document
      let prositeAnalytics = await PrositeAnalytics.findOne({
        userId: prositeUserId,
      });
      if (!prositeAnalytics) {
        prositeAnalytics = new PrositeAnalytics({
          userId: prositeUserId,
          visitors: [],
          totalVisitors: [{ visitors: 0, date: new Date() }],
          totalTimeSpent: 0,
          numberOfSessions: 0,
          demographics: {
            age: { "0-14": 0, "15-28": 0, "29-42": 0, "43-65": 0, "65+": 0 },
            gender: { male: 0, female: 0 },
          },
          location: {
            "Andaman & Nicobar Islands": 0,
            "Andhra Pradesh": 0,
            "Arunachal Pradesh": 0,
            Assam: 0,
            Bihar: 0,
            Chhattisgarh: 0,
            Chandigarh: 0,
            "Dadra & Nagar Haveli And Daman DIU": 0,
            "Daman & Diu": 0,
            Delhi: 0,
            Goa: 0,
            Gujarat: 0,
            Haryana: 0,
            "Himachal Pradesh": 0,
            "Jammu & Kashmir": 0,
            Jharkhand: 0,
            Karnataka: 0,
            Kerala: 0,
            Lakshadweep: 0,
            "Madhya Pradesh": 0,
            Maharashtra: 0,
            Manipur: 0,
            Meghalaya: 0,
            Mizoram: 0,
            Nagaland: 0,
            Odisha: 0,
            Puducherry: 0,
            Punjab: 0,
            Rajasthan: 0,
            Sikkim: 0,
            "Tamil Nadu": 0,
            Telangana: 0,
            Tripura: 0,
            "Uttar Pradesh": 0,
            Uttarakhand: 0,
            "West Bengal": 0,
          },
        });
      }

      // Helper function to determine age group
      const getAgeGroup = (age) => {
        if (age <= 14) return "0-14";
        if (age <= 28) return "15-28";
        if (age <= 42) return "29-42";
        if (age <= 65) return "43-65";
        return "65+";
      };

      const ageGroup = getAgeGroup(age);

      // Update demographics
      prositeAnalytics.demographics.age[ageGroup] =
        (prositeAnalytics.demographics.age[ageGroup] || 0) + 1;
      prositeAnalytics.demographics.gender[gender] =
        (prositeAnalytics.demographics.gender[gender] || 0) + 1;
      prositeAnalytics.location[state] =
        (prositeAnalytics.location[state] || 0) + 1;

      // Track visitors

      prositeAnalytics.visitors.push({ id: userId, visitDate: new Date() });

      const today = moment().startOf("day");

      // Check if today's entry exists in totalVisitors
      let todayEntry = prositeAnalytics.totalVisitors.find((entry) =>
        moment(entry.date).isSame(today, "day")
      );

      if (!todayEntry) {
        // If no entry for today, add a new one
        todayEntry = { visitors: 0, date: new Date() };
        prositeAnalytics.totalVisitors.push(todayEntry);
      }

      todayEntry.visitors += 1;

      prositeAnalytics.numberOfSessions += 1;
      const random = getRandomSeconds();
      prositeAnalytics.totalTimeSpent =
        prositeAnalytics.totalTimeSpent + random;

      // Save changes
      await prositeAnalytics.save();

      const prositeAnalyticsToSend = await PrositeAnalytics.findOne({
        userId,
      });

      const locationforProsite = Object.entries(
        prositeAnalyticsToSend?.location || {}
      ).map(([state, value]) => ({ state, value }));

      const locProsite = locationforProsite
        .sort((a, b) => b?.value - a?.value)
        .slice(0, 5);

      const totalValue = locationforProsite.reduce(
        (sum, item) => sum + item?.value,
        0
      );

      const actuallocProsite = locProsite.map((d) => ({
        state: d?.state,
        value: totalValue > 0 ? Math.round((d.value / totalValue) * 100) : 0,
      }));

      const obtainAgeProsite = Object.entries(
        prositeAnalyticsToSend?.demographics?.age || {}
      ).map(([age, value]) => ({ age, value }));
      const totalAgeValue = obtainAgeProsite.reduce(
        (sum, item) => sum + item?.value,
        0
      );

      const sendAgeProsite = obtainAgeProsite.map((d) => ({
        age: d.age,
        percent:
          totalAgeValue > 0 ? Math.round((d.value / totalAgeValue) * 100) : 0,
      }));

      const obtainGenderProsite = Object.entries(
        prositeAnalyticsToSend?.demographics?.gender || {}
      ).map(([gender, value]) => ({ gender, value }));
      const totalGenderValue = obtainGenderProsite.reduce(
        (sum, item) => sum + item?.value,
        0
      );

      const sendGenderProsite = obtainGenderProsite.map((d) => ({
        gender: d?.gender,
        percent:
          totalGenderValue > 0
            ? Math.round((d?.value / totalGenderValue) * 100)
            : 0,
      }));

      const totalVisitors = prositeAnalyticsToSend?.totalVisitors?.reduce(
        (sum, item) => sum + item?.visitors,
        0
      );

      const prositeData = {
        totalVisitors,
        visitors: prositeAnalyticsToSend?.totalVisitors,
        totalTimeSpent:
          prositeAnalyticsToSend?.totalTimeSpent /
          prositeAnalyticsToSend?.numberOfSessions,
        location: actuallocProsite,
        age: sendAgeProsite,
        gender: sendGenderProsite,
      };

      socket.emit(`prositeData:${userId}`, prositeData);
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("increase-member-count", async ({ comid, creator }) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0); // Set to the start of the day

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999); // Set to the end of the day

      const analytics = await Analytics.findOne({
        id: comid,
        creation: { $gte: startOfDay, $lte: endOfDay },
      });

      analytics.Y1 = analytics.Y1 + 1;

      const savedAnalytics = await analytics.save();

      const data = {
        id: savedAnalytics?._id,
        X: savedAnalytics?.date,
        Y1: savedAnalytics?.Y1,
        Y2: savedAnalytics?.Y2,
        Y3: savedAnalytics?.Y3,
        creation: savedAnalytics?.creation,
        activemembers: savedAnalytics?.activemembers.length || 0,
        newmembers: savedAnalytics?.newmembers.length || 0,
        paidmembers: savedAnalytics?.paidmembers.length || 0,
        newvisitor: savedAnalytics?.newvisitor.length || 0,
        returningvisitor: savedAnalytics?.returningvisitor.length || 0,
      };

      socket.emit(`inc-member-count-${creator}`, { data, comid });
    } catch (e) {
      console.log(e);
    }
  });

  socket.on("decrease-member-count", async ({ comid, creator }) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0); // Set to the start of the day

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999); // Set to the end of the day

      const analytics = await Analytics.findOne({
        id: comid,
        creation: { $gte: startOfDay, $lte: endOfDay },
      });

      analytics.Y1 = analytics.Y1 - 1;
      analytics.Y3 = analytics.Y3 - 1;
      const savedAnalytics = await analytics.save();

      const data = {
        id: savedAnalytics?._id,
        X: savedAnalytics?.date,
        Y1: savedAnalytics?.Y1,
        Y2: savedAnalytics?.Y2,
        Y3: savedAnalytics?.Y3,
        creation: savedAnalytics?.creation,
        activemembers: savedAnalytics?.activemembers.length || 0,
        newmembers: savedAnalytics?.newmembers.length || 0,
        paidmembers: savedAnalytics?.paidmembers.length || 0,
        newvisitor: savedAnalytics?.newvisitor.length || 0,
        returningvisitor: savedAnalytics?.returningvisitor.length || 0,
      };

      socket.emit(`dec-member-count-${creator}`, { data, comid });
    } catch (e) {
      console.log(e);
    }
  });

  socket.on("increase-visitor-count", async ({ comid, creator }) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const analytics = await Analytics.findOne({
        id: comid,
        creation: { $gte: startOfDay, $lte: endOfDay },
      });

      analytics.Y2 = analytics.Y2 + 1;

      const savedAnalytics = await analytics.save();

      const data = {
        id: savedAnalytics?._id,
        X: savedAnalytics?.date,
        Y1: savedAnalytics?.Y1,
        Y2: savedAnalytics?.Y2,
        Y3: savedAnalytics?.Y3,
        creation: savedAnalytics?.creation,
        activemembers: savedAnalytics?.activemembers.length || 0,
        newmembers: savedAnalytics?.newmembers.length || 0,
        paidmembers: savedAnalytics?.paidmembers.length || 0,
        newvisitor: savedAnalytics?.newvisitor.length || 0,
        returningvisitor: savedAnalytics?.returningvisitor.length || 0,
      };

      socket.emit(`inc-visitor-count-${creator}`, { data, comid });
    } catch (error) {
      console.log(error);
    }
  });

  socket.on("inc-sales", async ({ userid }) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const startOfDayString = formatDateToString(startOfDay);
    const endOfDayString = formatDateToString(endOfDay);

    // Query the database for dates in string format
    const storeAnalytics = await Analytics.findOne({
      id: userid,
      date: { $gte: startOfDayString, $lte: endOfDayString },
    }).sort({ date: -1 });

    storeAnalytics.Sales = storeAnalytics.Sales + 1;
    const savedAnalytics = await storeAnalytics.save();
    const data = {
      id: savedAnalytics?._id,
      Dates: savedAnalytics?.date,
      Sales: savedAnalytics?.Sales,
    };
    socket.emit(`inc-sales-${userid}`, { userid,data });
  });

  socket.on("disconnect", () => {
    try {
      console.log("User disconnected", socket.id);
      updateUserLeaveTime({ socketId: socket.id });
      removeUserFromAllRoomsBySocketId({ socketId: socket.id });
    } catch (error) {
      console.log(error);
    }
  });
});

const formatDateToString = (date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

function getRandomSeconds() {
  return Math.floor(Math.random() * 60) + 1;
}

http.listen(process.env.PORT, function () {
  console.log({
    rooms: `${process.env.PORT}`,
    messeage: "server started",
    secure: false,
  });
});

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
      sequence:
        (await Message.countDocuments({ conversationId: data?.convId })) + 1,
      timestamp: data?.timestamp,
      replyId: data?.replyId,
      rec: data?.reciever,
    });
    await message.save();
    console.log("Saved");
  } catch (e) {
    console.error("Error saving chat:", e);
  }
};

const savemsg = async (data) => {
  try {
    let content = {};
    if (data?.typ === "gif") {
      content = {
        uri: data?.url,
      };
    }

    const message = new Message({
      text: data?.text,
      sender: data?.sender_id,
      topicId: data?.sendtopicId,
      typ: data?.typ,
      mesId: data?.mesId,
      reply: data?.reply,
      dissapear: data?.dissapear,
      comId: data?.comId,
      sequence:
        data?.typ === "gif"
          ? (await Message.countDocuments({ comId: data?.comId })) + 1
          : data?.sequence,
      timestamp: data?.timestamp,
      content: data?.typ === "gif" ? content : undefined,
    });

    await message.save();
    console.log("Saved");
  } catch (e) {
    console.error("Error saving message:", e);
  }
};

const sendNoti = async (data) => {
  try {
    const user = await User.findById(data?.reciever);
    const sender = await User.findById(data?.sender_id);

    if (!user || !sender) {
      throw new Error("User or sender not found.");
    }

    const senderpic = process.env.URL + sender.profilepic;

    if (!user.conversations.includes(data?.convId)) {
      await User.updateOne(
        { _id: data?.reciever },
        {
          $push: {
            conversations: data?.convId,
          },
        }
      );
    }

    if (!user.muted?.includes(data?.convId)) {
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
              : data?.typ === "gif"
              ? "GIF"
              : data?.text,
        },
        data: {
          screen: "Conversation",
          sender_fullname: data?.sender_fullname,
          sender_id: data?.sender_id,
          text: data?.text,
          convId: data?.convId,
          createdAt: data?.timestamp,
          senderpic,
        },
        token: user.notificationtoken,
      };

      await admin.messaging().send(message);
      console.log("Notification sent successfully");
    }
  } catch (e) {
    console.error("Error in sendNoti:", e);
  }
};

const sendNotifcation = async (data) => {
  try {
    const topic = await Topic.findById(data?.sendtopicId).populate({
      path: "notifications.id",
      model: "User",
      select: "notificationtoken",
    });

    if (!topic) {
      throw new Error("Topic not found.");
    }

    const subscribedTokens = topic.notifications?.map((t) =>
      t?.muted ? null : t.id.notificationtoken
    );

    const tokens = subscribedTokens?.filter((token) => token !== null) || [];

    if (tokens.length > 0) {
      const message = {
        notification: {
          title: data?.comtitle,
          body: `${data?.sender_fullname}: ${data?.text}`,
        },
        data: {
          screen: "ComChat",
          sender_fullname: data?.sender_fullname,
          text: data?.text,
        },
        tokens,
      };

      await admin.messaging().sendEachForMulticast(message);
      console.log("Community notification sent successfully");
    } else {
      console.warn("No valid tokens found.");
    }
  } catch (e) {
    console.error("Error in sendNotifcation:", e);
  }
};

const sendNotifcationCommunity = async ({ id, postId, optionId, comId }) => {
  try {
    const coms = await Community.findById(comId).populate({
      path: "notifications.id",
      model: "User",
      select: "notificationtoken",
    });
    const post = await Post.findById(postId);
    const user = await User.findById(id);

    if (!coms || !post || !user) {
      throw new Error("Community, post, or user not found.");
    }

    const subscribedTokens = coms.notifications?.map((t) =>
      t?.muted ? null : t.id.notificationtoken
    );

    const tokens = subscribedTokens?.filter((token) => token !== null) || [];

    if (tokens.length > 0) {
      const message = {
        notification: {
          title: coms.title,
          body: `${user.fullname} voted in ${post.title}`,
        },
        data: {
          screen: "CommunityChat",
          text: "A New Vote is Here!",
          postId,
        },
        tokens,
      };

      await admin.messaging().sendEachForMulticast(message);
      console.log("Community notification sent successfully");
    } else {
      console.warn("No valid tokens found for community notification.");
    }
  } catch (e) {
    console.error("Error in sendNotifcationCommunity:", e);
  }
};
