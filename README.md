# Youmi Lens

AI Lecture Companion for International Students  
留学生 AI 课堂辅助工具

---

## 🎬 Demo 演示（建议先看）

https://youtu.be/A8gJnwJlhC4

---

## 🚀 Download 下载

👉 **Download the latest version (macOS Apple Silicon)：**  
👉 **下载最新版（适用于 Apple Silicon 芯片 Mac）：**  
https://github.com/Ayden-Z0410/youmi-lens/releases/download/v0.1.7-beta/Youmi_Lens_Beta_v0.1.7_macOS_AppleSilicon.dmg

---

## ⚡ Quick Start 快速开始

1. Download the DMG file  
   下载 DMG 文件  

2. Open the DMG and drag **Youmi Lens** into **Applications**  
   打开 DMG，把 **Youmi Lens** 拖入 **Applications（应用程序）**

3. Open **Youmi Lens**  
   打开 **Youmi Lens**

4. Click **Start** to begin recording  
   点击 **Start** 开始录制  

5. View captions in real time  
   查看实时字幕  

6. Generate summaries after recording  
   录制结束后生成总结  

---

## ⚠️ macOS 提示“已损坏”解决方法（重要）

If macOS shows:  
**“Youmi Lens is damaged and can’t be opened”**

如果 macOS 提示：  
**“Youmi Lens 已损坏，无法打开”**

---

### 👉 Step 1: Open Terminal（打开终端）

方法一（推荐）：
- Press `Command + Space`
- Type **Terminal**
- Press Enter  

方法二：
- 打开 Finder  
- 进入 Applications（应用程序）  
- 打开 Utilities（实用工具）  
- 打开 Terminal（终端）

---

### 👉 Step 2: Run these commands（复制并执行以下命令）

复制下面所有内容，一行一行粘贴到终端并回车：
sudo xattr -dr com.apple.quarantine “/Applications/Youmi Lens.app”
codesign –force –deep –sign - “/Applications/Youmi Lens.app”
sudo xattr -cr “/Applications/Youmi Lens.app”
open “/Applications/Youmi Lens.app”

---

### 👉 Step 3: Enter password（输入密码）

- You may be asked to enter your Mac password  
- 输入时屏幕不会显示字符（这是正常的）

---

## 🎯 What it does 功能介绍

• Real-time English captions（实时英文字幕）  
• Chinese translation（中文字幕翻译）  
• Lecture recording（课程录音保存）  
• AI summaries (EN + ZH)（中英文总结）  

---

## 💡 Why I built this 为什么做这个产品

Lectures can be hard to follow for international students.  
Professors speak fast. You miss details.

Youmi Lens is built to fix that.

留学生在课堂上常常听不懂教授快速讲解，容易错过重点。  
Youmi Lens 就是为了解决这个问题而设计。

---

## 👀 Who is this for 适用人群

• International students（留学生）  
• Non-native English speakers（非英语母语者）  
• Anyone struggling with lectures（听课困难的人）  

---

## 🧪 Status 当前状态

Beta version — actively improving  
测试版本，持续优化中  

Note: This beta build is not notarized yet.  
当前版本尚未通过 Apple 官方签名验证  

---

## 📩 Feedback 反馈

youmilens@gmail.com
