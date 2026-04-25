# Uno RP Ultra Final

## التشغيل
npm install
npm start

## تعديل النصوص
عدّل ملف:
data/site.json

## النشر على Render
Build Command:
npm install

Start Command:
npm start

## Discord OAuth
PUBLIC_BASE_URL=https://YOUR-RENDER-APP.onrender.com
REDIRECT_URI=https://YOUR-RENDER-APP.onrender.com/callback

ضع نفس الرابط في Discord Developer Portal.

## Stripe Webhook
https://YOUR-RENDER-APP.onrender.com/stripe/webhook
Event:
checkout.session.completed

## ملاحظات
- تم حذف الصوت بالكامل.
- الواجهة صارت بتخطيط جديد: الإدارة يسار، المحتوى وسط، الأخبار يمين.
- المتجر أعيد تصميم صوره بشكل أنظف.
- النصوص الأساسية قابلة للتعديل من data/site.json.


## تعديل الرئيسية
- الخلفية الرئيسية: public/assets/home-bg.png
- بيانات فريق الإدارة: data/site.json
- الأخبار: data/news.json
