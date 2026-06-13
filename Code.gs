// ==========================================
// โค้ดเวอร์ชันปรับปรุงระดับสูงพร้อมระบบส่ง Log เข้า Gmail อัตโนมัติ (Email Debugging Agent)
// ==========================================

// ตัวแปรสะสม Log ระหว่างรันสคริปต์
var logMessages = [];

function writeLog(message, type) {
  const timestamp = new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
  });
  const logLine = `[${timestamp}] [${type || "INFO"}] ${message}`;
  logMessages.push(logLine);

  // พิมพ์ลงในระบบปกติของ Google ด้วย
  if (type === "ERROR" || type === "EXCEPTION") {
    console.error(logLine);
  } else if (type === "WARN") {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

// ฟังก์ชันส่ง Email ไปยัง Gmail ของเจ้าของสคริปต์เมื่อจบ doPost
function sendLogsEmail() {
  try {
    let email = "";
    try {
      email = Session.getActiveUser().getEmail();
    } catch (e) {}

    // สำรองในกรณีค่าว่างเปล่า (กรอกอีเมลของคุณโดยตรง)
    if (!email || email.indexOf("@") === -1) {
      email = "kitisak.junsong@gmail.com";
    }

    const subject = "⚠️ บันทึกการทำงาน LINE Calorie Bot (Debug Logs)";
    const body =
      "เรียนคุณกิตติศักดิ์,\n\nนี่คือบันทึกประวัติการทำงาน (Debug Logs) ของบอทจากการทำธุรกรรมล่าสุด:\n\n" +
      "-----------------------------------------\n" +
      logMessages.join("\n") +
      "\n" +
      "-----------------------------------------\n\n" +
      "อีเมลฉบับนี้ถูกส่งโดยระบบอัตโนมัติของสคริปต์เพื่อช่วยเหลือในการแก้ปัญหาความเงียบของบอทครับ";

    MailApp.sendEmail(email, subject, body);
    console.log("ส่งประวัติ Log ไปยังอีเมลเรียบร้อยแล้ว: " + email);
  } catch (err) {
    console.error("ไม่สามารถส่งอีเมล Log ได้: " + err.toString());
  }
}

// ฟังก์ชันสำหรับทดสอบลิงก์ Webhook ผ่าน Web Browser (GET Request)
function doGet(e) {
  writeLog("doGet ถูกเรียกใช้งาน", "INFO");
  // sendLogsEmail();
  return ContentService.createTextOutput(
    "WEBHOOK IS WORKING! (Status 200 OK)",
  ).setMimeType(ContentService.MimeType.TEXT);
}

// ฟังก์ชันหลักสำหรับรับ Webhook จาก LINE (POST Request)
function doPost(e) {
  try {
    writeLog("--- เริ่มต้นการทำงานของ doPost ---", "INFO");

    if (typeof e === "undefined" || !e.postData || !e.postData.contents) {
      writeLog("ไม่มีข้อมูล postData ส่งเข้ามายัง Webhook", "WARN");
      // sendLogsEmail();
      return ContentService.createTextOutput("OK").setMimeType(
        ContentService.MimeType.TEXT,
      );
    }

    writeLog(
      "ข้อมูลดิบที่ได้รับจาก LINE (Raw Payload): " + e.postData.contents,
      "INFO",
    );

    const eventParams = JSON.parse(e.postData.contents);
    if (!eventParams.events || eventParams.events.length === 0) {
      writeLog(
        "ได้รับ Request ว่างเปล่า หรือไม่มี events (เช่น การกด Verify จากระบบ LINE)",
        "INFO",
      );
      // sendLogsEmail();
      return ContentService.createTextOutput("OK").setMimeType(
        ContentService.MimeType.TEXT,
      );
    }

    const event = eventParams.events[0];
    writeLog("ประเภทของ Event ที่ได้รับ: " + event.type, "INFO");

    const userId = event.source && event.source.userId ? event.source.userId : "";
    const replyToken = event.replyToken;

    // 1. ตรวจสอบสถานะการบล็อกและการลงทะเบียนของผู้ใช้งาน (Fast Block Check & Single Load Optimization)
    let userProfile = null;
    if (userId) {
      userProfile = getUserProfile(userId);
      if (userProfile && userProfile.status === "blocked") {
        writeLog(`[Blocked User Alert] UserID: ${userId} พยายามเข้าใช้งานบอทแต่โดนระงับสิทธิ์ -> สกัดการทำงาน`, "WARN");
        if (replyToken) {
          replyLineMessage(replyToken, "คุณไม่สามารถใช้งานได้ในขณะนี้ กรุณาติดต่อกลับที่ admin");
        }
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    }

    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      
      writeLog(
        `ได้รับข้อความจากผู้ใช้: "${userMessage}" | UserID: ${userId} | Reply Token: ${replyToken}`,
        "INFO",
      );

      if (!userId) {
        replyLineMessage(replyToken, "ขออภัยค่ะ ระบบไม่สามารถตรวจสอบข้อมูล User ID ของคุณได้ในขณะนี้");
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }

      // 2. ตรวจสอบข้อมูลโปรไฟล์ผู้ใช้งานก่อน
      if (!userProfile || !userProfile.birthDate) {
        const gender = userProfile ? userProfile.gender : "";
        
        // ลองตรวจสอบว่าข้อความที่ส่งมาเป็นวันเกิดในรูปแบบที่กำหนดหรือไม่ (Text Fallback)
        const typedBirthDate = extractBirthDateFromString(userMessage);
        if (typedBirthDate && gender) {
          writeLog(`ตรวจพบวันเกิดพิมพ์ตรงจากแชท: ${typedBirthDate} สำหรับ User: ${userId}`, "INFO");
          const success = saveUserProfile(userId, typedBirthDate, gender);
          if (success) {
            const age = calculateAge(typedBirthDate);
            const maxCalories = getMaxCalories(age, gender);
            const welcomeCard = welcomeProfileFlex(age, gender, maxCalories);
            replyLineMessage(replyToken, welcomeCard);
          } else {
            replyLineMessage(replyToken, "ขออภัยค่ะ ระบบฐานข้อมูลขัดข้อง ไม่สามารถบันทึกโปรไฟล์ส่วนบุคคลของคุณได้ชั่วคราว");
          }
          return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
        }
        
        if (!gender) {
          writeLog(`ไม่พบข้อมูลโปรไฟล์สำหรับ User ID: ${userId} -> ส่งกล่องสมัครโปรไฟล์`, "INFO");
          const onboardingCard = askGenderFlex();
          replyLineMessage(replyToken, onboardingCard);
        } else {
          writeLog(`มีเพศ (${gender}) แล้วแต่ยังไม่มีวันเกิดสำหรับ User: ${userId} -> ส่งปุ่มเลือกวันเกิดและแนะนำการพิมพ์ตรง`, "INFO");
          const nextCard = askBirthDateFlex(gender);
          const fallbackText = "⚠️ อุปกรณ์ของคุณอาจไม่รองรับหน้าต่างเลือกวันเกิดอัตโนมัติ (เช่น LINE Desktop)\n\n👉 คุณสามารถพิมพ์วันเกิดของคุณลงในแชทนี้ได้โดยตรงเลยค่ะ\n\n📌 รูปแบบ ค.ศ.: วัน/เดือน/ปีเกิด (เช่น 15/01/1988 หรือ 1988-01-15)";
          
          replyLineMessage(replyToken, [nextCard, { type: "text", text: fallbackText }]);
        }
        
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }

      // 3. หากมีโปรไฟล์แล้ว ประมวลผลข้อความตามปกติ
      let aiResponse = "";
      if (isSummaryRequest(userMessage)) {
        writeLog(`ตรวจพบคำสั่งขอสรุปแคลลอรี่รายวันสำหรับ User ID: ${userId}`, "INFO");
        aiResponse = getTodayCaloriesSummary(userId, userProfile);
        replyLineMessage(replyToken, aiResponse);
      } else if (isBurnRequest(userMessage)) {
        writeLog(`ตรวจพบคำสั่งขอคำแนะนำการเผาผลาญแคลส่วนเกินสำหรับ User ID: ${userId}`, "INFO");
        const burnAdviceCard = getTodayBurnAdvice(userId, userProfile);
        replyLineMessage(replyToken, burnAdviceCard);
      } else {
        // เรียกใช้งาน Google Gemini API เพื่อประมวลผลข้อมูล
        const aiResult = callGemini(userMessage);
        writeLog(`ผลลัพธ์ที่ประมวลผลจาก Gemini: ` + JSON.stringify(aiResult), "INFO");

        if (aiResult.success) {
          if (aiResult.isFood) {
            // บันทึกข้อมูลลง Google Sheet หากเป็นเมนูอาหาร/เครื่องดื่มจริง และเปลี่ยนการตอบกลับเป็น Flex Message
            saveToSheet(userId, userMessage, aiResult.calories);
            aiResponse = createFoodCalorieFlex(userMessage, aiResult.calories);
            replyLineMessage(replyToken, aiResponse);
          } else {
            // ไม่ใช่เมนูอาหาร/เครื่องดื่ม (ทักทาย หรือ พิมพ์มั่ว) -> ข้ามการบันทึกชีต ส่งข้อความแนะนำตัวธรรมดา
            replyLineMessage(replyToken, aiResult.errorText);
          }
        } else {
          // ในกรณีเชื่อมต่อระบบ AI ขัดข้องชั่วคราว
          replyLineMessage(replyToken, aiResult.errorText);
        }
      }
    } else if (event.type === "postback") {
      const postbackData = event.postback.data;
      const params = parseQueryString(postbackData);
      
      writeLog(`ได้รับ Event Postback: "${postbackData}" | UserID: ${userId} | Reply Token: ${replyToken}`, "INFO");
      
      if (!userId) {
        replyLineMessage(replyToken, "ขออภัยค่ะ ระบบไม่สามารถตรวจสอบข้อมูล User ID ของคุณผ่านปุ่มกดได้ในขณะนี้");
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }

      if (params.action === "select_gender") {
        const gender = params.gender;
        writeLog(`ผู้ใช้เลือกเพศ: ${gender} | บันทึกเพศแบบกึ่ง stateless`, "INFO");
        saveUserProfile(userId, "", gender); // บันทึกเพศเก็บไว้ก่อนเพื่อรอดึงวันเกิดในขั้นตอนต่อไป
        const nextCard = askBirthDateFlex(gender);
        const fallbackText = "⚠️ อุปกรณ์ของคุณอาจไม่รองรับหน้าต่างเลือกวันเกิดอัตโนมัติ (เช่น LINE Desktop)\n\n👉 คุณสามารถพิมพ์วันเกิดของคุณลงในแชทนี้ได้โดยตรงเลยค่ะ\n\n📌 รูปแบบ ค.ศ.: วัน/เดือน/ปีเกิด (เช่น 15/01/1988 หรือ 1988-01-15)";
        
        replyLineMessage(replyToken, [nextCard, { type: "text", text: fallbackText }]);
      } 
      else if (params.action === "register_profile") {
        const gender = params.gender;
        const birthDate = extractBirthDate(event);
        
        if (!birthDate) {
          writeLog("ไม่พบข้อมูลวันเกิด (อาจเป็น LINE Desktop)! แสดงคู่มือพิมพ์วันเกิดด้วยตนเอง", "INFO");
          const fallbackText = "⚠️ อุปกรณ์ของคุณไม่รองรับหน้าต่างเลือกวันเกิดอัตโนมัติ (เช่น LINE Desktop)\n\n👉 คุณสามารถพิมพ์วันเกิดของคุณลงในแชทนี้ได้โดยตรงเลยค่ะ\n\n📌 รูปแบบ ค.ศ.: วัน/เดือน/ปีเกิด (เช่น 15/01/1988 หรือ 1988-01-15)";
          replyLineMessage(replyToken, fallbackText);
        } else {
          // บันทึกลงตาราง Google Sheet: UserProfiles
          const success = saveUserProfile(userId, birthDate, gender);
          if (success) {
            const age = calculateAge(birthDate);
            const maxCalories = getMaxCalories(age, gender);
            const welcomeCard = welcomeProfileFlex(age, gender, maxCalories);
            replyLineMessage(replyToken, welcomeCard);
          } else {
            replyLineMessage(replyToken, "ขออภัยค่ะ ระบบฐานข้อมูลขัดข้อง ไม่สามารถบันทึกโปรไฟล์ส่วนบุคคลของคุณได้ชั่วคราว");
          }
        }
      }
    } else {
      writeLog(
        `ข้ามการทำงาน เนื่องจาก Event ไม่ใช่ข้อความประเภท Text หรือ Postback (Event Type: ${event.type})`,
        "INFO",
      );
    }

    writeLog("--- สิ้นสุดการทำงานของ doPost สำเร็จ ---", "INFO");
    // sendLogsEmail();
    return ContentService.createTextOutput("OK").setMimeType(
      ContentService.MimeType.TEXT,
    );
  } catch (error) {
    writeLog(
      "เกิดข้อผิดพลาดรุนแรงใน doPost: " +
        error.toString() +
        " | Stack: " +
        error.stack,
      "EXCEPTION",
    );
    // sendLogsEmail();
    return ContentService.createTextOutput("OK").setMimeType(
      ContentService.MimeType.TEXT,
    );
  }
}

// ฟังก์ชันสื่อสารกับ Google Gemini API
function callGemini(text) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    let GEMINI_API_KEY = scriptProperties.getProperty("GEMINI_API_KEY");

    if (GEMINI_API_KEY) {
      GEMINI_API_KEY = GEMINI_API_KEY.trim();
    }

    if (!GEMINI_API_KEY) {
      writeLog("ไม่พบตัวแปร GEMINI_API_KEY ใน Script Properties", "ERROR");
      return { success: false, errorText: "ขออภัยค่ะ บอทไม่พร้อมใช้งานเนื่องจากไม่ได้ตั้งค่า API Key สำหรับ AI" };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: "Input: " + text }] }],
      systemInstruction: {
        parts: [
          {
            text: 'You are an expert nutritionist. Evaluate if the user input is a valid food or drink item. ' +
                  'If it is a food or drink item, estimate its calorie count and respond strictly in this JSON format: ' +
                  '{ "isFood": true, "Calories": 350 }. ' +
                  'If it is not a food or drink item (such as gibberish, casual greetings, questions, or non-food topics), ' +
                  'generate a polite and friendly response in Thai guiding the user to input a food or drink, and respond strictly in this JSON format: ' +
                  '{ "isFood": false, "errorText": "กรุณาพิมพ์ระบุเฉพาะชื่อเมนูอาหารหรือเครื่องดื่มเพื่อคำนวณแคลอรี่นะคะ" }. ' +
                  'Do not write any conversational text outside the JSON, markdown blocks, or explanations. Return only raw, valid JSON.',
          },
        ],
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 150,
        responseMimeType: "application/json",
      },
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    writeLog("กำลังเชื่อมต่อไปยัง Gemini API...", "INFO");
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    writeLog(`สถานะ HTTP Status Code ของ Gemini: ${responseCode}`, "INFO");

    if (responseCode === 200) {
      const result = JSON.parse(responseText);
      if (
        result.candidates &&
        result.candidates.length > 0 &&
        result.candidates[0].content &&
        result.candidates[0].content.parts
      ) {
        const aiText = result.candidates[0].content.parts[0].text.trim();
        try {
          const jsonResponse = JSON.parse(aiText);
          const isFood = jsonResponse.isFood === true || jsonResponse.isFood === "true";
          const calories = parseFloat(jsonResponse.Calories) || 0;
          const errorText = jsonResponse.errorText || "ขออภัยค่ะ กรุณาพิมพ์ระบุเฉพาะชื่อเมนูอาหารหรือเครื่องดื่มเพื่อคำนวณแคลอรี่นะคะ";
          
          return {
            success: true,
            isFood: isFood,
            calories: calories,
            errorText: errorText
          };
        } catch (e) {
          writeLog("ไม่สามารถแปลงค่า JSON จาก AI ได้: " + e.toString() + " | AI Text: " + aiText, "WARN");
          return { success: false, errorText: "ขออภัยค่ะ ระบบประมวลผลข้อความขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งนะคะ" };
        }
      } else {
        writeLog("โครงสร้างของคำตอบ JSON ไม่เป็นไปตามคาด หรือถูกบล็อกจาก Safety Filters: " + responseText, "WARN");
        return { success: false, errorText: "ขออภัยค่ะ ระบบไม่สามารถตรวจสอบข้อมูลความปลอดภัยของเมนูนี้ได้" };
      }
    } else {
      writeLog(`การเรียกใช้งานผิดพลาด รหัสสถานะ ${responseCode} | ข้อมูลข้อผิดพลาด: ${responseText}`, "ERROR");
      return { success: false, errorText: "ขออภัยค่ะ ระบบประมวลผลความรู้โภชนาการขัดข้อง (Gemini API Error)" };
    }
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการเชื่อมโยงเครือข่ายของ Gemini: " + error.toString(), "EXCEPTION");
    return { success: false, errorText: "ขออภัยค่ะ ไม่สามารถเชื่อมต่อระบบวิเคราะห์แคลอรีได้ในขณะนี้" };
  }
}

// ฟังก์ชันส่งข้อความตอบกลับไปยังแอปพลิเคชัน LINE
function replyLineMessage(replyToken, messageContent) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    let LINE_CHANNEL_ACCESS_TOKEN = scriptProperties.getProperty(
      "LINE_CHANNEL_ACCESS_TOKEN",
    );

    if (LINE_CHANNEL_ACCESS_TOKEN) {
      LINE_CHANNEL_ACCESS_TOKEN = LINE_CHANNEL_ACCESS_TOKEN.trim();
    }

    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      writeLog(
        "ไม่พบตัวแปร LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties กรุณาตั้งค่าใหม่",
        "ERROR",
      );
      return;
    }

    const url = "https://api.line.me/v2/bot/message/reply";
    
    // ปรับเปลี่ยนตัวแปร payload ให้รองรับทั้งข้อความธรรมดา (String), Flex Message (Object) และแบบอาร์เรย์หลายข้อความ (Array)
    let messagesArray = [];
    if (Array.isArray(messageContent)) {
      messagesArray = messageContent;
    } else if (typeof messageContent === "object" && messageContent !== null) {
      messagesArray = [messageContent];
    } else {
      messagesArray = [{ type: "text", text: String(messageContent) }];
    }

    const payload = {
      replyToken: replyToken,
      messages: messagesArray,
    };

    const options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    writeLog("กำลังส่งข้อความตอบกลับไปยัง LINE...", "INFO");
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseTextJson = response.getContentText();

    writeLog(`สถานะ HTTP Status Code ของ LINE Reply: ${responseCode}`, "INFO");

    if (responseCode === 200) {
      writeLog("ส่งคำตอบกลับไปยังห้องแชท LINE สำเร็จเรียบร้อยแล้ว!", "INFO");
    } else {
      writeLog(
        `การส่งข้อความกลับผิดพลาด รหัสสถานะ ${responseCode} | คำอธิบาย: ${responseTextJson}`,
        "ERROR",
      );
      sendLogsEmail(); // เมื่อเกิดข้อผิดพลาดจาก LINE API ให้ส่ง Log เข้าอีเมลทันทีเพื่อบอกความผิดพลาดของ JSON Payload
    }
  } catch (error) {
    writeLog(
      "เกิดข้อผิดพลาดภายนอกในการเชื่อมโยงเครือข่ายของ LINE: " +
        error.toString(),
      "EXCEPTION",
    );
    sendLogsEmail();
  }
}

// ฟังก์ชันตรวจสอบความตั้งใจของผู้ใช้ (ว่าเป็นการขอสรุปข้อมูลแคลลอรี่รายวันหรือไม่)
function isSummaryRequest(message) {
  if (!message) return false;
  const cleaned = message.trim().toLowerCase();
  
  const keywords = [
    "วันนี้กินไปกี่แคล",
    "กินไปกี่แคลแล้ว",
    "สรุปแคลวันนี้",
    "แคลรวมวันนี้",
    "วันนี้กินอะไรไปบ้าง",
    "สรุปแคล",
    "แคลรวม",
    "กินไปกี่แคล",
    "today calories",
    "summary calories"
  ];
  
  for (let i = 0; i < keywords.length; i++) {
    if (cleaned.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  
  // ตรวจจับด้วย Regular Expression เพิ่มเติม เพื่อความยืดหยุ่นในการเขียนภาษาไทย
  const regex = /กิน.*กี่แคล|รวม.*แคล|สรุป.*แคล/;
  if (regex.test(cleaned)) {
    return true;
  }
  
  return false;
}

// ฟังก์ชันบันทึกรายการอาหารและแคลลอรี่ลง Google Sheet
function saveToSheet(userId, foodMenu, calories) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    if (!sheetId) {
      writeLog("ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties", "ERROR");
      return;
    }
    
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("MealLogs");
    if (!sheet) {
      writeLog("ไม่พบแผ่นงานชื่อ 'MealLogs' ใน Google Sheets", "ERROR");
      return;
    }
    
    const now = new Date();
    // เวลาไทยรูปแบบเต็มสำหรับ Timestamp เช่น 2026-05-25 09:45:30
    const timestamp = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    // วันที่ไทยรูปแบบสั้นสำหรับสืบค้น เช่น 2026-05-25
    const dateOnly = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd");
    
    const calNumber = parseFloat(calories) || 0;
    
    // เพิ่มแถวข้อมูลลงใน Google Sheet
    sheet.appendRow([timestamp, dateOnly, userId, foodMenu, calNumber]);
    writeLog(`[Sheet บันทึกสำเร็จ] User: ${userId} | Menu: ${foodMenu} | Calorie: ${calNumber} kcal`, "INFO");
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดรุนแรงในการบันทึกข้อมูลลง Google Sheet: " + error.toString(), "EXCEPTION");
    sendLogsEmail();
  }
}

// ฟังก์ชันดึงและสรุปแคลลอรี่ที่ทานไปทั้งหมดในวันนี้ของ User ID นั้นๆ
function getTodayCaloriesSummary(userId, userProfile) {
  try {
    const data = getTodayCaloriesData(userId, userProfile);
    if (!data) {
      return "ขออภัยค่ะ ระบบไม่สามารถดึงข้อมูลแคลลอรี่และโปรไฟล์ส่วนตัวของคุณได้ในขณะนี้";
    }

    if (data.todayMeals.length === 0) {
      return `วันนี้คุณยังไม่ได้บันทึกเมนูอาหารเลยค่ะ! เริ่มต้นพิมพ์ชื่อเมนูอาหารที่ทานเพื่อสะสมให้ถึงเป้าหมายรายวันของคุณที่ ${data.maxCalories} kcal ได้เลยนะคะ 🍽️`;
    }
    
    // คืนค่ารูปแบบ Flex Message ดีไซน์พรีเมียมส่วนบุคคล
    return createSummaryFlex(data.todayMeals, data.totalCalories, data.maxCalories);
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการดึงข้อมูลจากชีต: " + error.toString(), "EXCEPTION");
    sendLogsEmail();
    return "ขออภัยค่ะ เกิดข้อผิดพลาดในการคำนวณและสรุปยอดแคลลอรี่รวมของวันนี้";
  }
}

// ฟังก์ชันทดสอบสิทธิ์การเข้าถึงและการทำงานของ Google Sheet
// ให้เรียกกด Run ฟังก์ชันนี้ใน Google Apps Script Editor หนึ่งครั้ง เพื่อกดยอมรับสิทธิ์ (Authorization)
function testSheetAccess() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    console.log("GOOGLE_SHEET ID ที่ดึงมาได้: " + sheetId);
    
    if (!sheetId) {
      console.error("❌ ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties! กรุณาตรวจสอบว่าสะกดชื่อคีย์ถูกต้องและมีค่าแล้ว");
      return;
    }
    
    console.log("🔄 กำลังลองเปิดไฟล์ Google Sheet...");
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    console.log("✅ เปิดไฟล์สำเร็จ! ชื่อไฟล์: " + spreadsheet.getName());
    
    console.log("🔄 กำลังค้นหาแผ่นงานชื่อ 'MealLogs'...");
    const sheet = spreadsheet.getSheetByName("MealLogs");
    if (!sheet) {
      console.error("❌ ไม่พบแผ่นงานชื่อ 'MealLogs' ใน Google Sheets ไฟล์นี้! กรุณาตรวจสอบว่าชื่อแท็บสะกดตรงกันทุกตัวอักษร");
      return;
    }
    
    console.log("✅ ค้นพบแผ่นงาน 'MealLogs' สำเร็จ!");
    console.log("🔄 กำลังทดลองเขียนข้อมูลแถวจำลองเพื่อทดสอบระบบ...");
    
    const now = new Date();
    const timestamp = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    const dateOnly = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd");
    
    sheet.appendRow([timestamp, dateOnly, "TEST_USER_ID_12345", "ข้าวมันไก่จำลอง", 650]);
    console.log("🎉 เขียนข้อมูลจำลองสำเร็จ! กรุณาตรวจสอบใน Google Sheet ของคุณว่ามีแถว TEST_USER_ID_12345 ปรากฏขึ้นหรือไม่");
  } catch (error) {
    console.error("❌ เกิดข้อผิดพลาดรุนแรงในการทดสอบ: " + error.toString());
  }
}

// ฟังก์ชันสร้างกล่องข้อความ Flex Message สำหรับคำนวณแคลลอรี่รายเมนูอาหาร
function createFoodCalorieFlex(foodMenu, calories) {
  return {
    "type": "flex",
    "altText": `ผลการวิเคราะห์: ${foodMenu} มีค่าพลังงาน ${calories} kcal`,
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "วิเคราะห์แคลลอรี่อาหาร 🤖",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#FF5F6D",
          "endColor": "#FFC371"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "เมนูอาหารที่คุณรับประทาน:",
            "size": "xs",
            "color": "#8C8C8C"
          },
          {
            "type": "text",
            "text": foodMenu,
            "weight": "bold",
            "size": "lg",
            "color": "#333333",
            "wrap": true,
            "margin": "xs"
          },
          {
            "type": "separator",
            "margin": "md"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": String(calories),
                "size": "4xl",
                "weight": "bold",
                "color": "#E65C00",
                "align": "center"
              },
              {
                "type": "text",
                "text": "kcal",
                "size": "sm",
                "weight": "bold",
                "color": "#8C8C8C",
                "align": "center",
                "margin": "none"
              }
            ],
            "margin": "md"
          },
          {
            "type": "text",
            "text": "บันทึกลงในชีตของคุณเรียบร้อยแล้วค่ะ! 📝",
            "size": "xs",
            "color": "#999999",
            "align": "center",
            "margin": "md"
          }
        ],
        "paddingAll": "lg"
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#E65C00",
            "height": "sm",
            "action": {
              "type": "message",
              "label": "📊 สรุปแคลรวมวันนี้",
              "text": "วันนี้กินไปกี่แคล"
            }
          }
        ],
        "paddingAll": "md"
      }
    }
  };
}

// ฟังก์ชันสร้างกล่องข้อความ Flex Message สำหรับสรุปรายการสะสมรายวันส่วนบุคคล
function createSummaryFlex(todayMeals, totalCalories, maxCalories) {
  let difference = maxCalories - totalCalories;
  let adviceColor = "#22C55E"; // Green default
  let adviceTitle = "";
  let adviceText = "";
  
  if (difference > 0) {
    // แคลลอรี่ยังไม่เกินเป้าหมาย
    adviceColor = "#22C55E"; // Green
    adviceTitle = `🟢 ยังทานได้อีก ${difference} kcal`;
    adviceText = `วันนี้คุณทานไปทั้งหมด ${totalCalories} kcal จากโควต้าแนะนำสำหรับอายุและเพศของคุณที่ ${maxCalories} kcal ค่ะ เลือกรับพลังงานดีๆ ในมื้อถัดไปนะคะ! 💪`;
  } else if (difference < 0) {
    // แคลลอรี่เกินเป้าหมาย
    const exceeded = Math.abs(difference);
    adviceColor = "#EF4444"; // Red
    adviceTitle = `⚠️ ทานเกินเป้าหมายไป ${exceeded} kcal`;
    adviceText = `วันนี้ร่างกายคุณรับพลังงานเกินเป้าหมายสุขภาพส่วนบุคคล (${maxCalories} kcal) ไปแล้ว ${exceeded} kcal แนะนำเน้นกิจกรรมเดินหรือออกกำลังกายเพื่อช่วยเบิร์นแคลลอรี่ส่วนเกินออกน้า 🏃‍♀️`;
  } else {
    // พอดีพอดีเป๊ะ
    adviceColor = "#F97316"; // Orange
    adviceTitle = "🎯 ทานครบถ้วนพอดีเป้าหมาย!";
    adviceText = `ยอดเยี่ยมมากค่ะ! วันนี้คุณทานสะสมพลังงานได้ครบถ้วนเท่ากับขีดจำกัดสูงสุด ${maxCalories} kcal พอดิบพอดี รักษาวินัยที่ยอดเยี่ยมนี้ต่อนะคะ! ✨`;
  }

  // สร้างรายการอาหารแบบตารางไดนามิก
  let mealComponents = [];
  for (let i = 0; i < todayMeals.length; i++) {
    mealComponents.push({
      "type": "box",
      "layout": "horizontal",
      "contents": [
        {
          "type": "text",
          "text": `${i + 1}. ${todayMeals[i].menu}`,
          "size": "sm",
          "color": "#333333",
          "wrap": true,
          "flex": 4
        },
        {
          "type": "text",
          "text": `${todayMeals[i].calories} kcal`,
          "size": "sm",
          "color": "#666666",
          "align": "end",
          "flex": 2,
          "weight": "bold"
        }
      ],
      "margin": "sm"
    });
    
    if (i < todayMeals.length - 1) {
      mealComponents.push({
        "type": "separator",
        "margin": "sm",
        "color": "#F0F0F0"
      });
    }
  }

  return {
    "type": "flex",
    "altText": `สรุปโภชนาการวันนี้: ${totalCalories}/${maxCalories} kcal`,
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "สรุปแคลสะสมวันนี้ 🍽️",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#4B6CB7",
          "endColor": "#182848"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "แคลลอรี่สะสมรวมทั้งหมด:",
            "size": "xs",
            "color": "#8C8C8C"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": String(totalCalories),
                "size": "4xl",
                "weight": "bold",
                "color": adviceColor,
                "align": "center"
              },
              {
                "type": "text",
                "text": `จากเป้าหมาย ${maxCalories} kcal`,
                "size": "xs",
                "color": "#8C8C8C",
                "align": "center",
                "margin": "none"
              }
            ],
            "margin": "md"
          },
          {
            "type": "separator",
            "margin": "lg"
          },
          {
            "type": "text",
            "text": "📝 รายการเมนูอาหารประจำวัน:",
            "size": "xs",
            "weight": "bold",
            "color": "#8C8C8C",
            "margin": "lg"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": mealComponents,
            "margin": "md"
          },
          {
            "type": "separator",
            "margin": "lg"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": adviceTitle,
                "weight": "bold",
                "size": "sm",
                "color": adviceColor
              },
              {
                "type": "text",
                "text": adviceText,
                "size": "xs",
                "color": "#666666",
                "wrap": true,
                "margin": "xs"
              }
            ],
            "margin": "lg",
            "paddingAll": "md",
            "backgroundColor": "#F9F9F9",
            "cornerRadius": "sm"
          }
        ],
        "paddingAll": "lg"
      }
    }
  };
}

// ฟังก์ชันแยกแยะพารามิเตอร์ประเภท Query String (ข้อมูล Postback จาก LINE)
function parseQueryString(queryString) {
  let params = {};
  if (!queryString) return params;
  const pairs = queryString.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split("=");
    params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
  }
  return params;
}

// ฟังก์ชันอ่านข้อมูลโปรไฟล์ผู้ใช้จากตาราง UserProfiles
function getUserProfile(userId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    if (!sheetId) {
      writeLog("ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties", "ERROR");
      return null;
    }
    
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("UserProfiles");
    if (!sheet) {
      writeLog("ไม่พบแผ่นงานชื่อ 'UserProfiles' ใน Google Sheets", "ERROR");
      return null;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return null;
    }
    
    // ดึง UserID, BirthDate, Gender, RegisteredAt, Status (ขยายช่วงการดึงข้อมูลเพิ่มเป็น 5 คอลัมน์)
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (String(row[0]).trim() === userId.trim()) {
        let birthDateStr = "";
        const dateVal = row[1];
        if (dateVal instanceof Date) {
          birthDateStr = Utilities.formatDate(dateVal, "Asia/Bangkok", "yyyy-MM-dd");
        } else {
          birthDateStr = String(dateVal).trim();
        }
        
        return {
          userId: String(row[0]).trim(),
          birthDate: birthDateStr,
          gender: String(row[2]).trim(),
          status: row[4] ? String(row[4]).trim() : "accessed" // ปลอดภัย 100%: ถ้าคอลัมน์สิทธิ์ว่างเปล่า ให้แปลงเป็น accessed โดยอัตโนมัติ
        };
      }
    }
    return null;
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการดึงประวัติผู้ใช้งาน: " + error.toString(), "EXCEPTION");
    return null;
  }
}

// ฟังก์ชันบันทึกโปรไฟล์ผู้ใช้งานลงในตาราง UserProfiles (รองรับการ Upsert เพื่อไม่ให้เกิดแถวซ้ำ)
function saveUserProfile(userId, birthDate, gender) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    if (!sheetId) {
      writeLog("ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties", "ERROR");
      return false;
    }
    
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("UserProfiles");
    if (!sheet) {
      writeLog("ไม่พบแผ่นงานชื่อ 'UserProfiles' ใน Google Sheets", "ERROR");
      return false;
    }
    
    const now = new Date();
    const registeredAt = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    
    const lastRow = sheet.getLastRow();
    let userRowIndex = -1;
    
    // ค้นหาว่าผู้ใช้นี้เคยมีข้อมูลแถวเดิมหรือไม่
    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // ดึงคอลัมน์ UserID ทั้งหมด
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === userId.trim()) {
          userRowIndex = i + 2; // แปลงเป็น index แบบ 1-based (รวม Header)
          break;
        }
      }
    }
    
    if (userRowIndex !== -1) {
      // ถ้าพบข้อมูลเดิม ให้ทำการอัปเดตค่าเฉพาะฟิลด์ที่ส่งเข้ามา (หากส่งค่าว่าง ให้คงค่าเดิม ยกเว้นต้องการล้างค่า)
      // คอลัมน์: 1=UserID, 2=BirthDate, 3=Gender, 4=RegisteredAt, 5=Status
      
      const currentBirthDate = sheet.getRange(userRowIndex, 2).getValue();
      const currentGender = sheet.getRange(userRowIndex, 3).getValue();
      
      const finalBirthDate = (birthDate !== undefined && birthDate !== "") ? birthDate.trim() : currentBirthDate;
      const finalGender = (gender !== undefined && gender !== "") ? gender.trim() : currentGender;
      
      sheet.getRange(userRowIndex, 2).setValue(finalBirthDate);
      sheet.getRange(userRowIndex, 3).setValue(finalGender);
      sheet.getRange(userRowIndex, 4).setValue(registeredAt);
      
      // การอัปเดตจะไม่ก้าวล่วงสถานะ Status ของผู้ใช้เพื่อป้องกันสิทธิ์หลุดลอย
      writeLog(`[Sheet อัปเดตโปรไฟล์] User: ${userId} | BirthDate: ${finalBirthDate} | Gender: ${finalGender}`, "INFO");
    } else {
      // ถ้าไม่พบ ให้เพิ่มแถวใหม่ พร้อมสถานะ accessed เป็นค่าเริ่มต้นลงในคอลัมน์ที่ 5
      sheet.appendRow([userId.trim(), birthDate.trim(), gender.trim(), registeredAt, "accessed"]);
      writeLog(`[Sheet เพิ่มโปรไฟล์ใหม่] User: ${userId} | BirthDate: ${birthDate} | Gender: ${gender} | Status: accessed`, "INFO");
    }
    return true;
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการบันทึกโปรไฟล์ผู้ใช้: " + error.toString(), "EXCEPTION");
    return false;
  }
}

// ฟังก์ชันคำนวณอายุของผู้ใช้งานจากวันเกิด (ปีเกิดและเปรียบเทียบเดือน/วันปัจจุบัน)
function calculateAge(birthDateStr) {
  try {
    const birthDate = new Date(birthDateStr);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch (e) {
    writeLog("ไม่สามารถคำนวณอายุจาก " + birthDateStr + " ได้: " + e.toString(), "WARN");
    return 30; // ส่งค่าเฉลี่ยวัยทำงานเป็นค่าเริ่มต้นกรณีฉุกเฉิน
  }
}

// ฟังก์ชันกำหนดจำนวนพลังงานแคลลอรี่สูงสุดรายวัน (Max Calories) อ้างอิงตามเกณฑ์แพทย์และช่วงวัย
function getMaxCalories(age, gender) {
  const isMale = (gender === "ชาย" || gender === "male");
  
  if (age >= 4 && age <= 8) {
    return isMale ? 1400 : 1200;
  } else if (age >= 9 && age <= 13) {
    return isMale ? 1800 : 1600;
  } else if (age >= 14 && age <= 18) {
    return isMale ? 2200 : 1800;
  } else if (age >= 19 && age <= 30) {
    return isMale ? 2400 : 2000;
  } else if (age >= 31 && age <= 50) {
    return isMale ? 2200 : 1800;
  } else if (age >= 51) {
    return isMale ? 2000 : 1600;
  } else {
    // เด็กเล็กอายุต่ำกว่า 4 ปี หรือกรณีนอกเหนือตาราง
    return isMale ? 1400 : 1200;
  }
}

// ฟังก์ชันส่งการ์ด Flex Message ถามเพศสภาพของผู้ใช้งาน (ขั้นตอนที่ 1/2)
function askGenderFlex() {
  return {
    "type": "flex",
    "altText": "กรุณาตั้งค่าโปรไฟล์เพื่อเริ่มใช้งานบอทแคลลอรี่",
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ตั้งค่าโปรไฟล์ 🤖 (ขั้นตอนที่ 1/2)",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#4A00E0",
          "endColor": "#8E2DE2"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ยินดีต้อนรับสู่ LINE Calories AI! เพื่อความแม่นยำในการแนะนำพลังงานโภชนาการที่เหมาะสมกับสุขภาพของคุณ กรุณาตั้งค่าข้อมูลโปรไฟล์สั้นๆ ดังนี้ค่ะ:",
            "size": "xs",
            "color": "#666666",
            "wrap": true
          },
          {
            "type": "separator",
            "margin": "md"
          },
          {
            "type": "text",
            "text": "กรุณาเลือกเพศสภาพของคุณ:",
            "weight": "bold",
            "size": "sm",
            "color": "#333333",
            "margin": "lg"
          }
        ],
        "paddingAll": "lg"
      },
      "footer": {
        "type": "box",
        "layout": "horizontal",
        "spacing": "md",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#4A00E0",
            "height": "sm",
            "action": {
              "type": "postback",
              "label": "เพศชาย 🧑",
              "data": "action=select_gender&gender=ชาย"
            }
          },
          {
            "type": "button",
            "style": "primary",
            "color": "#E91E63",
            "height": "sm",
            "action": {
              "type": "postback",
              "label": "เพศหญิง 👩",
              "data": "action=select_gender&gender=หญิง"
            }
          }
        ],
        "paddingAll": "md"
      }
    }
  };
}

// ฟังก์ชันส่งการ์ด Flex Message ถามวันเกิดโดยใช้ LINE Datetime Picker (ขั้นตอนที่ 2/2)
function askBirthDateFlex(gender) {
  const todayStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
  
  return {
    "type": "flex",
    "altText": "กรุณาเลือกวันเกิดเพื่อวิเคราะห์สุขภาพของคุณ",
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ตั้งค่าโปรไฟล์ 🤖 (ขั้นตอนที่ 2/2)",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#4A00E0",
          "endColor": "#8E2DE2"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ได้รับข้อมูลเพศสภาพแล้วเรียบร้อยค่ะ! ขั้นตอนสุดท้ายคือการเลือกวันเกิด เพื่อคำนวณอายุและเกณฑ์แคลลอรี่ที่เหมาะสมกับตัวคุณ:",
            "size": "xs",
            "color": "#666666",
            "wrap": true
          },
          {
            "type": "separator",
            "margin": "md"
          },
          {
            "type": "box",
            "layout": "horizontal",
            "contents": [
              {
                "type": "text",
                "text": "เพศที่เลือก:",
                "size": "xs",
                "color": "#8C8C8C",
                "flex": 2
              },
              {
                "type": "text",
                "text": gender,
                "size": "xs",
                "weight": "bold",
                "color": gender === "ชาย" ? "#4A00E0" : "#E91E63",
                "flex": 4
              }
            ],
            "margin": "md"
          }
        ],
        "paddingAll": "lg"
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#8E2DE2",
            "height": "sm",
            "action": {
              "type": "datetimepicker",
              "label": "📅 เลือกวันเกิดของคุณ",
              "data": "action=register_profile&gender=" + gender,
              "mode": "date",
              "initial": "2000-01-01",
              "max": todayStr,
              "min": "1900-01-01"
            }
          }
        ],
        "paddingAll": "md"
      }
    }
  };
}

// ฟังก์ชันส่งการ์ด Flex Message แจ้งความยินดีเมื่อสมัครโปรไฟล์สำเร็จ
function welcomeProfileFlex(age, gender, maxCalories) {
  return {
    "type": "flex",
    "altText": "ลงทะเบียนสำเร็จ ยินดีต้อนรับค่ะ!",
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ลงทะเบียนโปรไฟล์สำเร็จ! 🎉",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#11998e",
          "endColor": "#38ef7d"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "บอทวิเคราะห์สุขภาพของคุณและพร้อมดูแลคุณทันทีค่ะ:",
            "size": "xs",
            "color": "#666666",
            "wrap": true
          },
          {
            "type": "separator",
            "margin": "md"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "เพศของคุณ:",
                    "size": "xs",
                    "color": "#8C8C8C",
                    "flex": 3
                  },
                  {
                    "type": "text",
                    "text": gender,
                    "size": "xs",
                    "weight": "bold",
                    "color": "#333333",
                    "flex": 3
                  }
                ],
                "margin": "sm"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "อายุปัจจุบัน:",
                    "size": "xs",
                    "color": "#8C8C8C",
                    "flex": 3
                  },
                  {
                    "type": "text",
                    "text": age + " ปี",
                    "size": "xs",
                    "weight": "bold",
                    "color": "#333333",
                    "flex": 3
                  }
                ],
                "margin": "sm"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "เป้าหมายโภชนาการ:",
                    "size": "xs",
                    "color": "#8C8C8C",
                    "flex": 3
                  },
                  {
                    "type": "text",
                    "text": maxCalories + " kcal/วัน",
                    "size": "xs",
                    "weight": "bold",
                    "color": "#11998e",
                    "flex": 3
                  }
                ],
                "margin": "sm"
              }
            ],
            "margin": "md"
          },
          {
            "type": "separator",
            "margin": "md"
          },
          {
            "type": "text",
            "text": "พิมพ์เมนูอาหาร เช่น 'ข้าวมันไก่' เพื่อคำนวณและบันทึกประวัติ หรือพิมพ์ 'วันนี้กินไปกี่แคล' เพื่อดูผลวิเคราะห์สุขภาพส่วนบุคคลได้เลยค่ะ! 🍽️",
            "size": "xs",
            "color": "#8C8C8C",
            "wrap": true,
            "margin": "md"
          }
        ],
        "paddingAll": "lg"
      }
    }
  };
}

// ฟังก์ชันดึงวันเกิดอย่างยืดหยุ่นและปลอดภัยจากข้อมูล Event Postback
function extractBirthDate(event) {
  if (!event || !event.postback) return "";
  
  let rawDate = "";
  if (event.postback.params) {
    const params = event.postback.params;
    rawDate = params.date || params.datetime || "";
    
    if (!rawDate) {
      // ลองตรวจสอบคีย์แรกสุดกรณีระบบ LINE client บางรุ่นส่งชื่อฟิลด์ต่างออกไป
      const keys = Object.keys(params);
      if (keys.length > 0) {
        rawDate = params[keys[0]];
      }
    }
  }
  
  if (!rawDate) return "";
  
  const dateStr = String(rawDate).trim();
  
  // 1. รูปแบบ yyyy-MM-dd (มาตรฐานของ LINE)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // 2. รูปแบบ yyyy-MM-ddTHH:mm
  if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) {
    return dateStr.split("T")[0];
  }
  
  // 3. รูปแบบ dd/MM/yyyy (เช่น 15/01/1988)
  const dmyMatch = dateStr.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1];
    const month = dmyMatch[2];
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  // 4. รูปแบบ yyyy/MM/dd
  const ymdMatch = dateStr.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2];
    const day = ymdMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  return dateStr; // คืนค่าข้อมูลดิบตัวเดิมกรณีคลาดเคลื่อน
}

// ฟังก์ชันสกัดหาวันเกิดจากข้อความตัวอักษรธรรมดาที่พิมพ์ในแชท (เช่น 15/01/1988 หรือ 1988-01-15)
function extractBirthDateFromString(text) {
  if (!text) return "";
  const cleanText = text.trim();
  
  // 1. ตรวจสอบรูปแบบ dd/MM/yyyy หรือ dd-MM-yyyy (เช่น 15/01/1988)
  const dmyMatch = cleanText.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    let day = dmyMatch[1];
    let month = dmyMatch[2];
    const year = dmyMatch[3];
    
    // เติมเลข 0 ข้างหน้าหากหลักเดียว
    if (day.length === 1) day = "0" + day;
    if (month.length === 1) month = "0" + month;
    
    // ตรวจสอบค่าความถูกต้องเบื้องต้น (เช่น วัน < 31, เดือน < 12)
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= new Date().getFullYear()) {
      return `${year}-${month}-${day}`;
    }
  }
  
  // 2. ตรวจสอบรูปแบบ yyyy/MM/dd หรือ yyyy-MM-dd (เช่น 1988-01-15)
  const ymdMatch = cleanText.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    let month = ymdMatch[2];
    let day = ymdMatch[3];
    
    if (day.length === 1) day = "0" + day;
    if (month.length === 1) month = "0" + month;
    
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= new Date().getFullYear()) {
      return `${year}-${month}-${day}`;
    }
  }
  
  return "";
}

// ฟังก์ชันตรวจสอบความตั้งใจของผู้ใช้ (ว่าเป็นการขอแนะนำการเผาผลาญ/ออกกำลังกายออกแคลลอรี่ส่วนเกินหรือไม่)
function isBurnRequest(message) {
  if (!message) return false;
  const cleaned = message.trim().toLowerCase();
  
  const keywords = [
    "กินเกิน burn ยังไง",
    "กินเกิน เบิร์นยังไง",
    "เบิร์นยังไง",
    "burn ยังไง",
    "ออกกำลังกายลดแคล",
    "กินเกินทำไง",
    "ช่วยเบิร์นแคล",
    "วิธีลดแคลเกิน",
    "ออกกำลังกายลดแคลลอรี่"
  ];
  
  for (let i = 0; i < keywords.length; i++) {
    if (cleaned.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  
  const regex = /กินเกิน.*เบิร์น|กินเกิน.*burn|เบิร์น.*ยังไง|burn.*ยังไง/;
  return regex.test(cleaned);
}

// ฟังก์ชันร่วมดึงยอดแคลลอรี่สะสมและเป้าหมายของวันนี้
function getTodayCaloriesData(userId, userProfile) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    if (!sheetId) {
      writeLog("ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties", "ERROR");
      return null;
    }

    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("MealLogs");
    if (!sheet) {
      writeLog("ไม่พบแผ่นงานชื่อ 'MealLogs' ใน Google Sheets", "ERROR");
      return null;
    }

    const lastRow = sheet.getLastRow();
    const age = calculateAge(userProfile.birthDate);
    const maxCalories = getMaxCalories(age, userProfile.gender);

    if (lastRow <= 1) {
      return { totalCalories: 0, todayMeals: [], maxCalories: maxCalories, age: age };
    }

    const now = new Date();
    const todayStr = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd");
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    
    let totalCalories = 0;
    let todayMeals = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const dateVal = row[1];
      const userVal = row[2];
      const foodVal = row[3];
      const calVal = parseFloat(row[4]) || 0;
      
      let rowDateStr = "";
      if (dateVal instanceof Date) {
        rowDateStr = Utilities.formatDate(dateVal, "Asia/Bangkok", "yyyy-MM-dd");
      } else {
        rowDateStr = String(dateVal).trim();
      }
      
      if (userVal === userId && rowDateStr === todayStr) {
        totalCalories += calVal;
        todayMeals.push({
          menu: foodVal,
          calories: calVal
        });
      }
    }
    
    return { totalCalories: totalCalories, todayMeals: todayMeals, maxCalories: maxCalories, age: age };
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดใน getTodayCaloriesData: " + error.toString(), "EXCEPTION");
    return null;
  }
}

// ฟังก์ชันหลักคำนวณและดึงคำแนะนำการเผาผลาญแคลส่วนเกิน
function getTodayBurnAdvice(userId, userProfile) {
  try {
    const data = getTodayCaloriesData(userId, userProfile);
    if (!data) {
      return "ขออภัยค่ะ ระบบไม่สามารถดึงข้อมูลแคลลอรี่และโปรไฟล์ส่วนตัวของคุณได้ในขณะนี้";
    }
    
    const exceededCalories = Math.ceil(data.totalCalories - data.maxCalories);
    
    if (exceededCalories <= 0) {
      // แคลลอรี่ยังไม่เกินเป้าหมาย
      return `วันนี้คุณทานสะสมไป ${data.totalCalories} kcal จากขีดจำกัดสูงสุด ${data.maxCalories} kcal (ยังไม่เกินโควต้าค่ะ) จึงยังไม่มีแคลลอรี่ส่วนเกินที่ต้องเผาผลาญเป็นพิเศษนะคะ แนะนำเน้นออกกำลังกายเบาๆ เพื่อสุขภาพที่ดีค่ะ! 🟢💪`;
    }
    
    // ส่งโปรไฟล์ให้ Gemini คำนวณวิธีเผาผลาญ
    const burnAdvice = callGeminiForBurnAdvice(data.age, userProfile.gender, exceededCalories);
    
    if (burnAdvice.success) {
      // คืนค่ารูปแบบ Flex Message ดีไซน์พรีเมียมส่วนบุคคล
      return createBurnAdviceFlex(data.age, userProfile.gender, exceededCalories, burnAdvice.exercises);
    } else {
      return `วันนี้คุณทานเกินเป้าหมายรายวันไปแล้ว ${exceededCalories} kcal นะคะ! (ระบบการออกแบบแผนเบิร์นขัดข้องชั่วคราว) แนะนำเน้นเดินเร็วหรือจ๊อกกิ้งเบาๆ 30-45 นาทีเพื่อช่วยเร่งเผาผลาญพลังงานเบื้องต้นก่อนนะคะ 🏃‍♂️`;
    }
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการคำนวณแผนการเบิร์น: " + error.toString(), "EXCEPTION");
    return "ขออภัยค่ะ เกิดข้อผิดพลาดในการคำนวณคำแนะนำการเบิร์นพลังงานของวันนี้";
  }
}

// ฟังก์ชันดึงวิธีออกกำลังกาย 3 รูปแบบจาก Gemini API อิงเกณฑ์บุคคล
function callGeminiForBurnAdvice(age, gender, exceededCalories) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    let GEMINI_API_KEY = scriptProperties.getProperty("GEMINI_API_KEY");
    if (GEMINI_API_KEY) {
      GEMINI_API_KEY = GEMINI_API_KEY.trim();
    }
    if (!GEMINI_API_KEY) {
      return { success: false };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    
    const promptText = `User Profile: Age ${age} years old, Gender ${gender}. Today, they have eaten an excess of ${exceededCalories} kcal beyond their daily health limit. Generate exactly 3 personalized physical exercises or activities suitable for their age, gender, and the exact calories to burn (${exceededCalories} kcal). Provide durations and details in Thai.`;
    
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: {
        parts: [
          {
            text: 'You are an expert fitness coach and personal trainer. Create exactly 3 customized exercise options to burn off the specified excess calories. ' +
                  'Tailor the difficulty, impact level, and duration to the user\'s age and gender (e.g. recommend low-impact activities for older users and higher intensity for younger users). ' +
                  'Respond strictly in this JSON format:\n' +
                  '{\n' +
                  '  "exercises": [\n' +
                  '    {\n' +
                  '      "name": "Exercise name in Thai",\n' +
                  '      "duration": "Duration in Thai (e.g. 45 นาที)",\n' +
                  '      "detail": "A brief encouraging description in Thai, explaining the distance/speed or intensity suitable for their age"\n' +
                  '    }\n' +
                  '  ]\n' +
                  '}\n' +
                  'Do not write any markdown code blocks, explanations, or conversational text outside the JSON. Return only raw, valid JSON.',
          },
        ],
      },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
      },
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    writeLog("กำลังเรียก Gemini เพื่อคำนวณวิธีการออกกำลังกาย...", "INFO");
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      const result = JSON.parse(responseText);
      if (
        result.candidates &&
        result.candidates.length > 0 &&
        result.candidates[0].content &&
        result.candidates[0].content.parts
      ) {
        const aiText = result.candidates[0].content.parts[0].text.trim();
        try {
          const jsonResponse = JSON.parse(aiText);
          if (jsonResponse && Array.isArray(jsonResponse.exercises)) {
            return { success: true, exercises: jsonResponse.exercises };
          }
        } catch (e) {
          writeLog("ไม่สามารถพาร์ส JSON แนะนำการออกกำลังกายได้: " + e.toString() + " | AI Text: " + aiText, "WARN");
        }
      }
    }
    return { success: false };
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดรุนแรงใน callGeminiForBurnAdvice: " + error.toString(), "EXCEPTION");
    return { success: false };
  }
}

// ฟังก์ชันสร้างการ์ด Flex Message แนะนำการเผาผลาญพลังงาน (ดีไซน์พรีเมียมสีแดงส้ม)
function createBurnAdviceFlex(age, gender, exceededCalories, exercises) {
  let exerciseComponents = [];
  
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    exerciseComponents.push({
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "box",
          "layout": "horizontal",
          "contents": [
            {
              "type": "text",
              "text": `🔥 วิธีที่ ${i + 1}: ${ex.name}`,
              "weight": "bold",
              "size": "sm",
              "color": "#333333",
              "flex": 4,
              "wrap": true
            },
            {
              "type": "text",
              "text": ex.duration,
              "weight": "bold",
              "size": "sm",
              "color": "#FF4B2B",
              "align": "end",
              "flex": 2
            }
          ]
        },
        {
          "type": "text",
          "text": ex.detail,
          "size": "xs",
          "color": "#666666",
          "wrap": true,
          "margin": "xs"
        }
      ],
      "margin": "md"
    });
    
    if (i < exercises.length - 1) {
      exerciseComponents.push({
        "type": "separator",
        "margin": "md",
        "color": "#F0F0F0"
      });
    }
  }

  return {
    "type": "flex",
    "altText": `คำแนะนำการเผาผลาญพลังงานส่วนเกิน: +${exceededCalories} kcal`,
    "contents": {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "แผนการเผาผลาญพลังงานวันนี้ 🏃‍♀️",
            "weight": "bold",
            "color": "#FFFFFF",
            "size": "sm",
            "align": "center"
          }
        ],
        "background": {
          "type": "linearGradient",
          "angle": "135deg",
          "startColor": "#FF416C",
          "endColor": "#FF4B2B"
        },
        "paddingAll": "md"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "แคลลอรี่ส่วนเกินของคุณในวันนี้:",
            "size": "xs",
            "color": "#8C8C8C"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": `+${exceededCalories} kcal`,
                "size": "4xl",
                "weight": "bold",
                "color": "#FF4B2B",
                "align": "center"
              },
              {
                "type": "text",
                "text": `เกณฑ์วิเคราะห์เฉพาะบุคคล: อายุ ${age} ปี (${gender})`,
                "size": "xs",
                "color": "#8C8C8C",
                "align": "center",
                "margin": "xs"
              }
            ],
            "margin": "md"
          },
          {
            "type": "separator",
            "margin": "lg"
          },
          {
            "type": "text",
            "text": "🏃‍♂️ 3 กิจกรรมออกกำลังกายที่แนะนำสำหรับคุณ:",
            "size": "xs",
            "weight": "bold",
            "color": "#8C8C8C",
            "margin": "lg"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": exerciseComponents,
            "margin": "md"
          },
          {
            "type": "separator",
            "margin": "lg"
          },
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "💡 เคล็ดลับเพิ่มเติมจากบอท:",
                "weight": "bold",
                "size": "xs",
                "color": "#FF4B2B"
              },
              {
                "type": "text",
                "text": "การออกกำลังกายช่วยรักษาดุลยภาพพลังงานที่ดีของร่างกาย การดื่มน้ำเปล่าให้พอเพียงก่อนและหลังการออกกำลังกายจะช่วยเร่งอัตราการเผาผลาญพลังงานได้ดียิ่งขึ้นนะคะ สู้ๆ ค่ะ! ✌️",
                "size": "xs",
                "color": "#666666",
                "wrap": true,
                "margin": "xs"
              }
            ],
            "margin": "lg",
            "paddingAll": "md",
            "backgroundColor": "#FFF5F5",
            "cornerRadius": "sm"
          }
        ],
        "paddingAll": "lg"
      }
    }
  };
}