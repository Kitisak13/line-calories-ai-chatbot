# รายการงาน (Tasks) - Personalized Calorie Limit & Onboarding

- [x] เขียนฟังก์ชันคำนวณอายุจำเพาะบุคคล `calculateAge(birthDateStr)`
- [x] เขียนฟังก์ชันกำหนดแคลลอรี่สูงสุดของเพศและอายุอ้างอิงตารางการแพทย์ `getMaxCalories(age, gender)`
- [x] พัฒนาฟังก์ชันอ่านและจัดการโปรไฟล์ใน Google Sheet `getUserProfile(userId)` และ `saveUserProfile(userId, birthDate, gender)` ด้วยระบบ Upsert อัจฉริยะป้องกันแถวซ้ำ
- [x] ออกแบบและเขียนฟังก์ชันสร้าง Onboarding Flex Messages:
  - [x] `askGenderFlex()` การ์ดเลือกเพศสภาพ (ชาย/หญิง)
  - [x] `askBirthDateFlex(gender)` การ์ดเลือกวันเกิด (LINE Native DatePicker)
  - [x] `welcomeProfileFlex(age, gender, maxCalories)` การ์ดต้อนรับเมื่อสมัครข้อมูลสำเร็จ
- [x] เพิ่มระบบจัดการและสลับการรันเหตุการณ์ใน `doPost(e)`:
  - [x] แยกเหตุการณ์ประเภท `postback` (การลงทะเบียนโปรไฟล์ขั้นตอนที่ 1 และ 2)
  - [x] ตรวจเช็คสิทธิ์โปรไฟล์ในคำถามปกติ (หากไม่มีให้สลับไปส่ง Onboarding Card)
  - [x] พัฒนาระบบสำรอง Text-Fallback ดักจับวันเกิดที่พิมพ์ตรงจากแชทเพื่อแก้ปัญหา LINE PC/Desktop
- [x] ปรับปรุงการ์ดสรุปสะสมประจำวัน `createSummaryFlex` เพื่อคำนวณพลังงานคงเหลือ/พลังงานเกิน และแสดงสไตล์สีเขียว/แดงไดนามิก
- [x] ทำการทดสอบและสรุปประวัติใน walkthrough.md
