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

    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;
      const userId = event.source && event.source.userId ? event.source.userId : "";
      
      writeLog(
        `ได้รับข้อความจากผู้ใช้: "${userMessage}" | UserID: ${userId} | Reply Token: ${replyToken}`,
        "INFO",
      );

      let aiResponse = "";
      if (isSummaryRequest(userMessage)) {
        if (!userId) {
          aiResponse = "ขออภัยค่ะ ระบบไม่สามารถระบุ User ID ของคุณได้ จึงไม่สามารถดึงข้อมูลประวัติแคลลอรี่ให้ได้ในขณะนี้";
        } else {
          writeLog(`ตรวจพบคำสั่งขอสรุปแคลลอรี่รายวันสำหรับ User ID: ${userId}`, "INFO");
          aiResponse = getTodayCaloriesSummary(userId);
        }
      } else {
        // 1. เรียกใช้งาน Google Gemini API เพื่อประมวลผลข้อมูล
        aiResponse = callGemini(userMessage);
        writeLog(`คำตอบที่ได้จาก Gemini: "${aiResponse}"`, "INFO");

        // 2. บันทึกข้อมูลลง Google Sheet หากคำนวณแคลลอรี่สำเร็จ และเปลี่ยนการตอบกลับเป็น Flex Message
        if (userId && aiResponse.indexOf("Calories: ") === 0) {
          const caloriesStr = aiResponse.replace("Calories: ", "").trim();
          const caloriesNum = parseFloat(caloriesStr) || 0;
          saveToSheet(userId, userMessage, caloriesNum);
          
          // แปลงการตอบกลับเป็น Flex Message ดีไซน์พรีเมียม
          aiResponse = createFoodCalorieFlex(userMessage, caloriesNum);
        }
      }

      // 3. ส่งข้อความตอบกลับไปยัง LINE Messaging API
      replyLineMessage(replyToken, aiResponse);
    } else {
      writeLog(
        `ข้ามการทำงาน เนื่องจาก Event ไม่ใช่ข้อความประเภท Text (Event Type: ${event.type})`,
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
      writeLog(
        "ไม่พบตัวแปร GEMINI_API_KEY ใน Script Properties กรุณาตั้งค่าใหม่",
        "ERROR",
      );
      return "ขออภัยค่ะ บอทไม่พร้อมใช้งานเนื่องจากไม่ได้ตั้งค่า API Key สำหรับ AI";
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: "Food: " + text }] }],
      systemInstruction: {
        parts: [
          {
            text: 'Estimate the calorie count of the specified food and respond strictly in this JSON format: { "Calories": 350 }. Do not write any conversational text, explanations, or code blocks. Return only raw, valid JSON.',
          },
        ],
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 100,
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
          if (jsonResponse && typeof jsonResponse.Calories !== "undefined") {
            return "Calories: " + jsonResponse.Calories;
          }
        } catch (e) {
          writeLog("ไม่สามารถแปลงค่า JSON จาก AI ได้: " + e.toString(), "WARN");
        }
        return aiText;
      } else {
        writeLog(
          "โครงสร้างของคำตอบ JSON ไม่เป็นไปตามคาด หรือถูกบล็อกจาก Safety Filters: " +
            responseText,
          "WARN",
        );
        return "ขออภัยค่ะ เมนูนี้ระบบไม่สามารถวิเคราะห์ข้อมูลแคลอรีได้";
      }
    } else {
      writeLog(
        `การเรียกใช้งานผิดพลาด รหัสสถานะ ${responseCode} | ข้อมูลข้อผิดพลาด: ${responseText}`,
        "ERROR",
      );
      return `ขออภัยค่ะ ระบบประมวลผลข้อความขัดข้อง (Gemini API Error Code: ${responseCode})`;
    }
  } catch (error) {
    writeLog(
      "เกิดข้อผิดพลาดในการเชื่อมโยงเครือข่ายของ Gemini: " + error.toString(),
      "EXCEPTION",
    );
    return "ขออภัยค่ะ ระบบไม่สามารถเชื่อมต่อกับฐานข้อมูลโภชนาการได้ในขณะนี้";
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
    
    // ปรับเปลี่ยนตัวแปร payload ให้รองรับทั้งข้อความธรรมดา (String) และ Flex Message (Object)
    let messagesArray = [];
    if (typeof messageContent === "object" && messageContent !== null) {
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
function getTodayCaloriesSummary(userId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    if (!sheetId) {
      writeLog("ไม่พบตัวแปร GOOGLE_SHEET ใน Script Properties", "ERROR");
      return "ขออภัยค่ะ บอทไม่สามารถเชื่อมต่อฐานข้อมูลได้เนื่องจากขาดการตั้งค่า GOOGLE_SHEET";
    }

    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("MealLogs");
    if (!sheet) {
      writeLog("ไม่พบแผ่นงานชื่อ 'MealLogs' ใน Google Sheets", "ERROR");
      return "ขออภัยค่ะ ไม่พบตารางประวัติข้อมูลอาหาร (MealLogs)";
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return "วันนี้คุณยังไม่ได้บันทึกเมนูอาหารเลยค่ะ! เริ่มต้นพิมพ์ชื่อเมนูอาหารที่ทานเพื่อบันทึกแคลลอรี่ได้เลยนะคะ 🍽️";
    }

    const now = new Date();
    const todayStr = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd");
    
    // ดึงข้อมูลทั้งหมดจากแถวที่ 2 เป็นต้นไป (คอลัมน์ A ถึง E)
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    
    let totalCalories = 0;
    let todayMeals = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const dateVal = row[1];       // คอลัมน์ B: Date
      const userVal = row[2];       // คอลัมน์ C: UserID
      const foodVal = row[3];       // คอลัมน์ D: FoodMenu
      const calVal = parseFloat(row[4]) || 0; // คอลัมน์ E: Calories
      
      // แปลงประเภทวันที่เพื่อรองรับความเสถียรในการเปรียบเทียบเชิงอักขระ
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
    
    if (todayMeals.length === 0) {
      return "วันนี้คุณยังไม่ได้บันทึกเมนูอาหารเลยค่ะ! เริ่มต้นพิมพ์ชื่อเมนูอาหารที่ทานเพื่อบันทึกแคลลอรี่ได้เลยนะคะ 🍽️";
    }
    
    // คืนค่ารูปแบบ Flex Message ดีไซน์พรีเมียม
    return createSummaryFlex(todayMeals, totalCalories);
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

// ฟังก์ชันสร้างกล่องข้อความ Flex Message สำหรับสรุปรายการสะสมรายวัน
function createSummaryFlex(todayMeals, totalCalories) {
  let adviceColor = "#22C55E"; // Green
  let adviceText = "✨ ยอดเยี่ยมค่ะ! วันนี้ร่างกายคุณยังรับพลังงานดีๆ เพิ่มได้อีกนะ ทานให้อิ่มและมีประโยชน์น้า!";
  let adviceTitle = "💪 พลังงานกำลังพอดี!";
  
  if (totalCalories > 2000) {
    adviceColor = "#EF4444"; // Red
    adviceText = "⚠️ วันนี้คุณทานแคลลอรี่เกิน 2,000 kcal แล้วนะคะ แนะนำให้จิบน้ำบ่อยๆ และเน้นอาหารประเภทผักและโปรตีนในมื้อถัดไปน้า 🏃‍♀️";
    adviceTitle = "⚠️ พลังงานเริ่มเกินแล้วค่ะ!";
  } else if (totalCalories >= 1500) {
    adviceColor = "#F97316"; // Orange
    adviceText = "💪 รักษาระดับแคลลอรี่ได้ดีมากค่ะ ใกล้ถึงเกณฑ์เป้าหมายของวันแล้ว เลือกทานอาหารที่ดีต่อสุขภาพต่อนะคะ!";
    adviceTitle = "🔥 ใกล้ถึงขีดเป้าหมาย!";
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
    "altText": `สรุปโภชนาการวันนี้: ${totalCalories} kcal`,
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
