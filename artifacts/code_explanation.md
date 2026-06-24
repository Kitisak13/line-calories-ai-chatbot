# 🤖 คู่มืออธิบายการทำงานของบอทแคลลอรี่ (สำหรับน้องๆ อายุ 12 ปี)

ยินดีต้อนรับน้องๆ เข้าสู่การเรียนรู้โค้ดเบื้องหลังของ **บอทวิเคราะห์แคลลอรี่สุดฉลาด** ในไฟล์ [Code.gs](file:///d:/Project/line-calories-ai-chatbot/Code.gs) ครับ พี่ได้สรุปการทำงานของฟังก์ชันหลักๆ ที่เปรียบเสมือนอวัยวะและสมองของบอทตัวนี้ โดยใช้การเปรียบเทียบง่ายๆ เพื่อให้น้องๆ เข้าใจกระบวนการทำงานได้รวดเร็วครับ!

---

### Code 1 แถวที่ : 64 - 256
**ฟังก์ชันการทำงาน :** **พี่ใหญ่ไปรษณีย์คอยรับจดหมาย (`doPost`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้เปรียบเหมือนพี่ใหญ่ไปรษณีย์ที่ยืนรอรับจดหมาย (Webhook) ที่ส่งมาจากแอป LINE เวลาที่ผู้ใช้ส่งข้อความ สติกเกอร์ หรือกดปุ่มในแชท LINE จะนำสารนั้นใส่ซองส่งมาที่นี่ พี่ใหญ่จะแกะซองออกอ่าน เช็คว่าเป็นใคร (UserID) พิมพ์อะไรมา แล้วตัดสินใจส่งต่อให้ฟังก์ชันอื่นๆ ทำงาน เช่น ส่งไปถามแคลอาหาร หรือส่งไปลงทะเบียนเพศและวันเกิดครับ
* **ตัวอย่างโค้ด :**
```javascript
function doPost(e) {
  try {
    writeLog("--- เริ่มต้นการทำงานของ doPost ---", "INFO");
    const eventParams = JSON.parse(e.postData.contents);
    const event = eventParams.events[0];
    const userId = event.source && event.source.userId ? event.source.userId : "";
    const replyToken = event.replyToken;

    let userProfile = null;
    if (userId) {
      userProfile = getUserProfile(userId);
      // ตรวจสอบความปลอดภัยว่าผู้ใช้คนนี้โดนบล็อกสิทธิ์การใช้งานหรือไม่
      if (userProfile && userProfile.status === "blocked") {
        if (replyToken) replyLineMessage(replyToken, "คุณไม่สามารถใช้งานได้ในขณะนี้");
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }
    }

    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      
      // 1. ตรวจสอบข้อมูลโปรไฟล์ผู้ใช้งานก่อน (ถ้าข้อมูลไม่ครบให้ไปกรอกเพศและวันเกิด)
      if (!userProfile || !userProfile.birthDate) {
        // ... (ระบบสมัครโปรไฟล์) ...
        return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
      }

      // 2. หากมีโปรไฟล์ครบถ้วนแล้ว ให้แยกประเภทคำสั่งทำงานปกติ
      let aiResponse = "";
      if (isSummaryRequest(userMessage)) {
        aiResponse = getTodayCaloriesSummary(userId, userProfile);
        replyLineMessage(replyToken, aiResponse);
      } else if (isBurnRequest(userMessage)) {
        const burnAdviceCard = getTodayBurnAdvice(userId, userProfile);
        replyLineMessage(replyToken, burnAdviceCard);
      } else {
        const aiResult = callGemini(userMessage);
        if (aiResult.success) {
          if (aiResult.isFood) {
            saveToSheet(userId, userMessage, aiResult.calories);
            aiResponse = createFoodCalorieFlex(userMessage, aiResult.calories);
            replyLineMessage(replyToken, aiResponse);
          } else {
            replyLineMessage(replyToken, aiResult.errorText);
          }
        } else {
          replyLineMessage(replyToken, aiResult.errorText);
        }
      }
    }
    // ...
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดรุนแรงใน doPost: " + error.toString(), "EXCEPTION");
  }
}
```

---

### Code 2 แถวที่ : 259 - 347
**ฟังก์ชันการทำงาน :** **สมองกลวิเศษจอมตอบคำถาม (`callGemini`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้ทำหน้าที่ติดต่อไปยังพี่ใหญ่ **Gemini AI** ของ Google โดยบอทจะส่งข้อความที่ผู้ใช้พิมพ์คุยด้วยไปถามว่า *"นี่คือเมนูอาหารใช่ไหม? ถ้าใช่บอกหน่อยว่ามีกี่แคลลอรี่ และถ้าไม่ใช่ ช่วยทักทายหรือตอบอย่างเหมาะสมเป็นภาษาไทยทีนะ"* จากนั้นรอฟังคำตอบและจัดรูปแบบข้อมูลให้อ่านง่ายครับ
* **ตัวอย่างโค้ด :**
```javascript
function callGemini(text) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    let GEMINI_API_KEY = scriptProperties.getProperty("GEMINI_API_KEY");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: text }] }],
      systemInstruction: {
        parts: [{
          text: 'You are a calorie counter bot. Determine if the user text is a food/drink. Respond ONLY in JSON: { "isFood": true/false, "calories": number or null, "errorText": "Thai greeting/guideline if not food" }'
        }]
      },
      generationConfig: { responseMimeType: "application/json" }
    };
    
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    // ... ดึงผลลัพธ์และส่งคืนข้อมูล { success, isFood, calories, errorText }
  } catch (error) {
    return { success: false, errorText: "ไม่สามารถเชื่อมต่อระบบวิเคราะห์ได้ในขณะนี้" };
  }
}
```

---

### Code 3 แถวที่ : 350 - 420
**ฟังก์ชันการทำงาน :** **นกพิราบคาบข่าวส่งจดหมายตอบกลับ (`replyLineMessage`)**
* **อธิบายง่ายๆ :** เมื่อบอทของเราประมวลผลเสร็จแล้วและได้คำตอบ ฟังก์ชันนี้จะทำหน้าที่เป็นนกพิราบคาบจดหมายคำตอบ บินเอาข้อมูลกลับไปตอบลูกค้าในหน้าแชท LINE ผ่านรหัสตั๋วตอบกลับ (ReplyToken) นั่นเองครับ
* **ตัวอย่างโค้ด :**
```javascript
function replyLineMessage(replyToken, messageContent) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const token = scriptProperties.getProperty("LINE_ACCESS_TOKEN");
    
    const url = "https://api.line.me/v2/bot/message/reply";
    let messagesPayload = [];
    
    if (Array.isArray(messageContent)) {
      messagesPayload = messageContent;
    } else if (typeof messageContent === "object") {
      messagesPayload = [messageContent];
    } else {
      messagesPayload = [{ type: "text", text: messageContent }];
    }
    
    const payload = { replyToken: replyToken, messages: messagesPayload };
    UrlFetchApp.fetch(url, {
      method: "post",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      payload: JSON.stringify(payload)
    });
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดในการส่งข้อความตอบกลับ LINE: " + error.toString(), "EXCEPTION");
  }
}
```

---

### Code 4 แถวที่ : 423 - 453
**ฟังก์ชันการทำงาน :** **เครื่องจับคีย์เวิร์ดขอสรุปประจำวัน (`isSummaryRequest`)**
* **อธิบายง่ายๆ :** ทำหน้าที่เปรียบเหมือนตัวกรองสแกนคำพูดว่าผู้ใช้พิมพ์แนวๆ ว่า "ขอยอดรวม", "สรุปแคลวันนี้" หรือ "กินไปกี่แคลแล้ว" หรือไม่ โดยใช้คำค้นหาทั่วไปและเขียน Pattern (Regex) เพื่อจับใจความคำพูดภาษาไทยยอดฮิตครับ
* **ตัวอย่างโค้ด :**
```javascript
function isSummaryRequest(message) {
  if (!message) return false;
  const cleaned = message.trim().toLowerCase();
  
  const keywords = ["สรุปแคล", "ขอยอดรวม", "วันนี้กินอะไรไปบ้าง", "สรุปพลังงาน"];
  for (let i = 0; i < keywords.length; i++) {
    if (cleaned.indexOf(keywords[i]) !== -1) return true;
  }
  
  const regex = /กิน.*กี่แคล|รวม.*แคล|สรุป.*แคล/;
  if (regex.test(cleaned)) return true;
  
  return false;
}
```

---

### Code 5 แถวที่ : 456 - 487
**ฟังก์ชันการทำงาน :** **คุณครูจดประวัติเมนูอาหารลงสมุดไดอารี่ (`saveToSheet`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้เมื่อได้ชื่ออาหารและแคลลอรี่มาแล้ว จะทำการเปิดสมุดโน้ตหน้าประวัติเมนูอาหาร (Google Sheets แท็บ `MealLogs`) แล้วหยิบดินสอมาเขียนวันเวลา รหัสผู้ใช้ ชื่ออาหาร และแคลลอรี่ลงไปท้ายสุดของตารางครับ
* **ตัวอย่างโค้ด :**
```javascript
function saveToSheet(userId, foodMenu, calories) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("MealLogs");
    
    const now = new Date();
    const timestamp = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    const dateOnly = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd");
    const calNumber = parseFloat(calories) || 0;
    
    sheet.appendRow([timestamp, dateOnly, userId, foodMenu, calNumber]);
    writeLog(`[Sheet บันทึกสำเร็จ] User: ${userId} | Menu: ${foodMenu} | Calorie: ${calNumber} kcal`, "INFO");
  } catch (error) {
    writeLog("เกิดข้อผิดพลาดรุนแรงในการบันทึกข้อมูลลง Google Sheet: " + error.toString(), "EXCEPTION");
  }
}
```

---

### Code 6 แถวที่ : 490 - 508
**ฟังก์ชันการทำงาน :** **ผู้จัดการรวมข้อมูลการกินประจำวัน (`getTodayCaloriesSummary`)**
* **อธิบายง่ายๆ :** มีหน้าที่คอยประสานงานเพื่อดึงข้อมูลสรุปอาหารวันนี้ของคนคนนั้นขึ้นมา จากนั้นประมวลผลเพื่อนำผลลัพธ์ไปแสดงผลเป็นการ์ดสรุปพลังงานสวยๆ ส่งกลับไปบอกผู้ใช้ครับ
* **ตัวอย่างโค้ด :**
```javascript
function getTodayCaloriesSummary(userId, userProfile) {
  try {
    const data = getTodayCaloriesData(userId, userProfile);
    if (!data) return "ขออภัยค่ะ ระบบไม่สามารถดึงข้อมูลแคลลอรี่และโปรไฟล์ส่วนตัวของคุณได้ในขณะนี้";

    if (data.todayMeals.length === 0) {
      return `วันนี้คุณยังไม่ได้บันทึกเมนูอาหารเลยค่ะ! เริ่มต้นพิมพ์ชื่อเมนูเพื่อสะสมให้ถึงเป้าหมาย ${data.maxCalories} kcal นะคะ 🍽️`;
    }
    
    return createSummaryFlex(data.todayMeals, data.totalCalories, data.maxCalories);
  } catch (error) {
    return "ขออภัยค่ะ เกิดข้อผิดพลาดในการคำนวณและสรุปยอดแคลลอรี่รวมของวันนี้";
  }
}
```

---

### Code 7 แถวที่ : 845 - 892
**ฟังก์ชันการทำงาน :** **ตู้เก็บแฟ้มประวัติส่วนตัวผู้ใช้ (`getUserProfile`)**
* **อธิบายง่ายๆ :** ทุกครั้งที่มีจดหมายเข้า ตู้เก็บแฟ้มนี้จะเปิดดูข้อมูลหน้าประวัติ (แท็บ `UserProfiles`) เพื่อหาข้อมูลวันเกิดและเพศของผู้ใช้คนนั้น หากเจอจะส่งออกไปเพื่อให้บอทรู้ว่าเขาอายุเท่าไหร่ เพศอะไร ควรทานพลังงานได้เท่าไหร่ครับ
* **ตัวอย่างโค้ด :**
```javascript
function getUserProfile(userId) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("UserProfiles");
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;
    
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (String(row[0]).trim() === userId.trim()) {
        let birthDateStr = row[1] instanceof Date ? 
          Utilities.formatDate(row[1], "Asia/Bangkok", "yyyy-MM-dd") : String(row[1]).trim();
        
        return {
          userId: String(row[0]).trim(),
          birthDate: birthDateStr,
          gender: String(row[2]).trim(),
          status: row[4] ? String(row[4]).trim() : "accessed"
        };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}
```

---

### Code 8 แถวที่ : 895 - 954
**ฟังก์ชันการทำงาน :** **ผู้ช่วยจดทะเบียนผู้ใช้ใหม่และแก้ไขประวัติ (`saveUserProfile`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้ช่วยคัดลอกข้อมูลส่วนตัวใหม่ไปเขียนลงในแฟ้มประวัติ (แท็บ `UserProfiles`) หากยังไม่มีชื่อคนนี้จะเพิ่มแถวใหม่ให้ แต่หากมีชื่อเดิมอยู่แล้ว ก็จะช่วยเปลี่ยนข้อมูลเดิมให้เป็นข้อมูลใหม่ล่าสุด (เช่น อัปเดตอายุหรือเพศ) ครับ
* **ตัวอย่างโค้ด :**
```javascript
function saveUserProfile(userId, birthDate, gender) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("UserProfiles");
    
    const now = new Date();
    const registeredAt = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    const lastRow = sheet.getLastRow();
    let userRowIndex = -1;
    
    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === userId.trim()) {
          userRowIndex = i + 2;
          break;
        }
      }
    }
    
    if (userRowIndex !== -1) {
      // มีประวัติเดิมอยู่แล้ว -> อัปเดตข้อมูล
      const currentBirthDate = sheet.getRange(userRowIndex, 2).getValue();
      const currentGender = sheet.getRange(userRowIndex, 3).getValue();
      const finalBirthDate = (birthDate !== undefined && birthDate !== "") ? birthDate.trim() : currentBirthDate;
      const finalGender = (gender !== undefined && gender !== "") ? gender.trim() : currentGender;
      
      sheet.getRange(userRowIndex, 2).setValue(finalBirthDate);
      sheet.getRange(userRowIndex, 3).setValue(finalGender);
      sheet.getRange(userRowIndex, 4).setValue(registeredAt);
    } else {
      // ผู้ใช้งานใหม่ -> เพิ่มข้อมูลเข้าแถวใหม่เลย
      sheet.appendRow([userId.trim(), birthDate.trim(), gender.trim(), registeredAt, "accessed"]);
    }
    return true;
  } catch (error) {
    return false;
  }
}
```

---

### Code 9 แถวที่ : 957 - 971
**ฟังก์ชันการทำงาน :** **เครื่องคิดเลขหาอายุของเด็กและผู้ใหญ่ (`calculateAge`)**
* **อธิบายง่ายๆ :** ฟังก์ชันอัจฉริยะนี้เมื่อได้วันเกิดของคนนั้นมา จะเอาปีเกิดลบกับปีปัจจุบัน และคำนวณเปรียบเทียบวันเดือนวันนี้ว่าผ่านวันเกิดปีนี้หรือยัง เพื่อคำนวณอายุของผู้ใช้ได้อย่างแม่นยำเป็นปีครับ
* **ตัวอย่างโค้ด :**
```javascript
function calculateAge(birthDateStr) {
  try {
    const birthDate = new Date(birthDateStr);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // ตรวจสอบเช็คว่าถ้ารอบเดือนปีนี้ยังไม่ถึงวันเกิด ให้หักอายุลง 1 ปี
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch (e) {
    return 30; // คืนค่าอายุเริ่มต้น 30 ปีในกรณีที่เกิดข้อผิดพลาด
  }
}
```

---

### Code 10 แถวที่ : 974 - 993
**ฟังก์ชันการทำงาน :** **สมุดกฎเกณฑ์ปริมาณพลังงานร่างกาย (`getMaxCalories`)**
* **อธิบายง่ายๆ :** เป็นตัวกำหนดขีดจำกัดแคลลอรี่ที่เหมาะสมต่อวัน เปรียบเหมือนคุณหมอวางกฎว่า เด็กเล็ก วัยรุ่น หรือผู้ใหญ่ ทั้งเพศชายและหญิง สามารถทานอาหารได้ไม่เกินวันละกี่กิโลแคลลอรี่เพื่อสุขภาพที่ดีนั่นเองครับ
* **ตัวอย่างโค้ด :**
```javascript
function getMaxCalories(age, gender) {
  const isMale = (gender === "ชาย" || gender === "male");
  
  if (age >= 4 && age <= 8) {
    return isMale ? 1400 : 1200;
  } else if (age >= 9 && age <= 13) {
    return isMale ? 1800 : 1600;
  } else if (age >= 14 && age <= 18) {
    return isMale ? 2200 : 1800;
  } else if (age >= 19 && age <= 30) {
    return isMale ? 2500 : 2000;
  } else if (age >= 31 && age <= 50) {
    return isMale ? 2200 : 1800;
  } else if (age >= 51) {
    return isMale ? 2000 : 1600;
  } else {
    return isMale ? 1400 : 1200;
  }
}
```

---

### Code 11 แถวที่ : 1316 - 1366
**ฟังก์ชันการทำงาน :** **ผู้แกะวันเกิดจากปุ่มปฏิทิน LINE (`extractBirthDate`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้ช่วยคอยจับสัญญาณเมื่อผู้ใช้ทำการคลิกเลือกวันเดือนปีเกิดบนปฏิทินที่บอทส่งให้ โดยมันจะแกะรหัสวันที่ออกมาจัดรูปแบบเป็นปี-เดือน-วัน (yyyy-MM-dd) ให้ถูกต้องเพื่อเตรียมเอาไปบันทึกครับ
* **ตัวอย่างโค้ด :**
```javascript
function extractBirthDate(event) {
  if (!event || !event.postback) return "";
  
  if (event.postback.params) {
    const params = event.postback.params;
    if (params.date) {
      return params.date;
    }
  }
  
  const postbackData = event.postback.data;
  const params = parseQueryString(postbackData);
  if (params.birthDate) {
    return decodeURIComponent(params.birthDate);
  }
  return "";
}
```

---

### Code 12 แถวที่ : 1369 - 1412
**ฟังก์ชันการทำงาน :** **ผู้ถอดรหัสวันเกิดที่พิมพ์มาเป็นตัวหนังสือปกติ (`extractBirthDateFromString`)**
* **อธิบายง่ายๆ :** ในกรณีที่อุปกรณ์ของผู้ใช้ไม่มีปุ่มปฏิทินให้เลือก (เช่น เล่นบนคอมพิวเตอร์ LINE Desktop) แล้วผู้ใช้ต้องพิมพ์ข้อความมา เช่น `15/01/1988` ฟังก์ชันนี้จะเป็นคนช่วยสแกนตัวหนังสือและแปลงข้อความเหล่านั้นให้กลายเป็นโค้ดวันที่ของระบบคอมพิวเตอร์นั่นเองครับ
* **ตัวอย่างโค้ด :**
```javascript
function extractBirthDateFromString(text) {
  if (!text) return "";
  const cleanText = text.trim();
  
  const dmyMatch = cleanText.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    let day = dmyMatch[1];
    let month = dmyMatch[2];
    const year = dmyMatch[3];
    
    if (day.length === 1) day = "0" + day;
    if (month.length === 1) month = "0" + month;
    
    return `${year}-${month}-${day}`;
  }
  return "";
}
```

---

### Code 13 แถวที่ : 1415 - 1439
**ฟังก์ชันการทำงาน :** **เครื่องตรวจจับใจความขอออกกำลังกายเบิร์นแคลลอรี่ (`isBurnRequest`)**
* **อธิบายง่ายๆ :** มีหน้าที่คอยสแกนดูข้อความที่พิมพ์เข้ามาว่าผู้ใช้อยากได้รับคำแนะนำเพื่อเผาผลาญไขมันหรือออกกำลังกายเบิร์นแคลหรือเปล่า เช่น คำว่า `"กินเกิน burn ยังไง"`, `"ช่วยเบิร์นแคลด้วยนะ"`
* **ตัวอย่างโค้ด :**
```javascript
function isBurnRequest(message) {
  if (!message) return false;
  const cleaned = message.trim().toLowerCase();
  
  const keywords = [
    "กินเกิน burn ยังไง", "กินเกิน เบิร์นยังไง", "เบิร์นยังไง", "burn ยังไง",
    "ออกกำลังกายลดแคล", "กินเกินทำไง", "ช่วยเบิร์นแคล", "วิธีลดแคลเกิน"
  ];
  
  for (let i = 0; i < keywords.length; i++) {
    if (cleaned.indexOf(keywords[i]) !== -1) return true;
  }
  
  const regex = /กินเกิน.*เบิร์น|กินเกิน.*burn|เบิร์น.*ยังไง|burn.*ยังไง/;
  return regex.test(cleaned);
}
```

---

### Code 14 แถวที่ : 1442 - 1501
**ฟังก์ชันการทำงาน :** **เครื่องสรุปข้อมูลการกินประจำวันส่วนบุคคล (`getTodayCaloriesData`)**
* **อธิบายง่ายๆ :** เป็นศูนย์รวมข้อมูลที่จะเดินทางไปหยิบสมุดบันทึกมื้ออาหารวันนี้ รวมผลรวมแคลลอรี่ที่ทานเข้าไป ดึงข้อมูลจำกัดพลังงาน และส่งต่อข้อมูลประมวลผลสุขภาพทั้งหมดให้กับฟังก์ชันอื่นๆ ดึงไปใช้ต่อ
* **ตัวอย่างโค้ด :**
```javascript
function getTodayCaloriesData(userId, userProfile) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const sheetId = scriptProperties.getProperty("GOOGLE_SHEET");
    const spreadsheet = SpreadsheetApp.openById(sheetId.trim());
    const sheet = spreadsheet.getSheetByName("MealLogs");
    
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
      if (row[2] === userId && String(row[1]) === todayStr) {
        totalCalories += parseFloat(row[4]) || 0;
        todayMeals.push({ menu: row[3], calories: parseFloat(row[4]) || 0 });
      }
    }
    return { totalCalories: totalCalories, todayMeals: todayMeals, maxCalories: maxCalories, age: age };
  } catch (error) {
    return null;
  }
}
```

---

### Code 15 แถวที่ : 1504 - 1531
**ฟังก์ชันการทำงาน :** **ผู้จัดการควบคุมสถานการณ์แคลลอรี่ล้นเกณฑ์ (`getTodayBurnAdvice`)**
* **อธิบายง่ายๆ :** ฟังก์ชันนี้จะเช็คก่อนว่า วันนี้ผู้ใช้กินอาหารแคลลอรี่รวมเกินโควต้าประจำตัวแล้วหรือยัง? **ถ้ายังไม่เกิน** จะส่งประโยคเชียร์อัพน่ารักๆ กลับไปหา แต่**หากกินเกินเกณฑ์** จะรีบคำนวณตัวเลขแคลลอรี่ส่วนเกินและประสานงานกับพี่เทรนเนอร์ Gemini AI ให้ออกแบบแผนออกกำลังกายมาให้ทันทีครับ
* **ตัวอย่างโค้ด :**
```javascript
function getTodayBurnAdvice(userId, userProfile) {
  try {
    const data = getTodayCaloriesData(userId, userProfile);
    if (!data) return "ขออภัยค่ะ ระบบไม่สามารถดึงข้อมูลแคลลอรี่และโปรไฟล์ส่วนตัวของคุณได้ในขณะนี้";
    
    const exceededCalories = Math.ceil(data.totalCalories - data.maxCalories);
    
    if (exceededCalories <= 0) {
      return `วันนี้คุณทานสะสมไป ${data.totalCalories} kcal จากขีดจำกัดสูงสุด ${data.maxCalories} kcal (ยังไม่เกินโควต้าค่ะ) จึงยังไม่มีแคลลอรี่ส่วนเกินที่ต้องเผาผลาญเป็นพิเศษนะคะ 🟢💪`;
    }
    
    const burnAdvice = callGeminiForBurnAdvice(data.age, userProfile.gender, exceededCalories);
    if (burnAdvice.success) {
      return createBurnAdviceFlex(data.age, userProfile.gender, exceededCalories, burnAdvice.exercises);
    } else {
      return `วันนี้คุณทานเกินเป้าหมายรายวันไปแล้ว ${exceededCalories} kcal นะคะ! แนะนำเน้นเดินเร็วหรือจ๊อกกิ้งเบาๆ 30-45 นาทีก่อนนะคะ 🏃‍♂️`;
    }
  } catch (error) {
    return "ขออภัยค่ะ เกิดข้อผิดพลาดในการคำนวณคำแนะนำการเบิร์นพลังงานของวันนี้";
  }
}
```

---

### Code 16 แถวที่ : 1534 - 1613
**ฟังก์ชันการทำงาน :** **เทรนเนอร์ออกกำลังกายส่วนตัวสมองกล (`callGeminiForBurnAdvice`)**
* **อธิบายง่ายๆ :** เปรียบเหมือนเทรนเนอร์ฟิตเนสสุดอัจฉริยะที่คอยคำนวณหาแผนการออกกำลังกาย 3 วิธีที่ดีที่สุด โดยอิงตามอายุ เพศ และปริมาณแคลลอรี่ส่วนเกินของบุคคลนั้น แล้วถามให้พี่ใหญ่ Gemini AI ช่วยคิดกิจกรรมออกกำลังกายแต่ละอย่างออกมาเป็นข้อๆ ที่เหมาะกับสภาพร่างกายครับ
* **ตัวอย่างโค้ด :**
```javascript
function callGeminiForBurnAdvice(age, gender, exceededCalories) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    let GEMINI_API_KEY = scriptProperties.getProperty("GEMINI_API_KEY");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    
    const promptText = `User Profile: Age ${age} years old, Gender ${gender}. Today, they have eaten an excess of ${exceededCalories} kcal. Generate exactly 3 personalized physical exercises suitable for their age, gender, and the exact calories to burn.`;
    
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: {
        parts: [{
          text: 'You are an expert fitness coach. Create exactly 3 customized exercise options. Tailor to user age and gender. Respond strictly in JSON format: { "exercises": [ { "name": "Exercise name in Thai", "duration": "Duration in Thai", "detail": "Encouraging description in Thai" } ] }'
        }]
      },
      generationConfig: { responseMimeType: "application/json" }
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    // ...
  } catch (error) {
    return { success: false };
  }
}
```
