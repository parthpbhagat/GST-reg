# GST Registration Automation Platform

## 📌 Project Overview
This project is an **End-to-End Automation Solution** designed to streamline, simplify, and fully automate the complex GST Registration process in India. 

Traditionally, filling out GST applications on the government portal is a tedious, multi-step process that requires manually uploading multiple documents, typing out lengthy addresses, and jumping through hoops of OTP validations. 
This platform solves that problem by providing:
1. A **Custom User-Friendly Web Form** for users to easily fill out their details.
2. An **Admin Dashboard** to review, accept, or reject applications.
3. A **Headless Browser Bot (Playwright)** that automatically goes to the official GST portal, types in all the data, uploads the correct documents, and handles OTPs/Captchas by prompting the admin in real-time.

---

## 🏗️ System Architecture

The project is divided into three main components:

### 1. Frontend (`/frontend`)
- **Tech Stack**: Vanilla HTML/JS/CSS, Vite, Supabase JS.
- **Features**:
  - Provides a beautiful, fully responsive (mobile-first) wizard interface for applicants to enter their GST details step-by-step.
  - Generates an automatic "Declaration Form" PDF using `html2pdf.js`.
  - Integrates MapmyIndia (Mappls) for Address Autocomplete and Pincode lookups.
  - Includes a secure Admin Dashboard to view pending applications.
  - Provides a real-time console view to monitor the background Playwright automation process and submit CAPTCHAs/OTPs on the fly.

### 2. Backend API (`/backend`)
- **Tech Stack**: Node.js, Express, SQLite, Socket.io, Supabase.
- **Features**:
  - Acts as the central communication hub.
  - Stores heavy file uploads (photos, proofs of constitution) locally to avoid database bloat.
  - Exposes REST endpoints to fetch jurisdictions, districts, and HSN/SAC codes.
  - Dynamically spawns the Playwright automation script.
  - Uses **Socket.io** to stream live logs, browser screenshots, and CAPTCHA images directly to the frontend admin panel.

### 3. Automation Bot (`/automation`)
- **Tech Stack**: Node.js, Playwright.
- **Features**:
  - A robust robotic process automation (RPA) script that controls a Chromium browser.
  - Simulates human typing, clicking, and file uploading on `reg.gst.gov.in`.
  - Intelligently waits for network requests and handles dynamic portal timeouts.
  - Features a **Robust Retry Loop**: If an incorrect OTP or CAPTCHA is entered by the admin, the bot safely clears the fields and asks for it again without crashing the flow.

---

## 🚀 Getting Started

To run the project locally, you will need to start both the backend server and the frontend development server.

### Prerequisites
- Node.js (v18+) installed on your machine.
- A Supabase Project (URL and Anon Key).

### 1. Start the Backend
The backend must be running to serve the API, manage files, and trigger the automation scripts.

```bash
cd backend
npm install
node server.js
```
The backend server will run on `http://localhost:3000`.

### 2. Start the Frontend
The frontend provides the user interface for applicants and admins. 
First, create a `.env` file in the frontend directory with your Supabase credentials (`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`).

Open a **new terminal window** and run:

```bash
cd frontend
npm install
npm run dev
```
The frontend web app will run on `http://localhost:5173`.

---

## 💻 Usage & Workflow

1. **Applicant Submission:** A user visits the frontend URL, fills out the wizard, and submits their application. Data is saved to Supabase, and files are sent to the Node backend.
2. **Admin Review:** An admin logs into the portal, navigates to "My Applications" (`/admin`), and clicks **Preview** on a pending application.
3. **Trigger Automation:** The admin clicks **Register Automatically**. 
4. **Live Execution:** A modal opens showing a live terminal. The Node backend spawns the Playwright bot.
5. **Human-in-the-Loop:** When the bot encounters a CAPTCHA or requires an Aadhaar/TRN OTP, it pauses. The backend sends a real-time request to the frontend via Socket.io. The admin sees the CAPTCHA image or OTP prompt, types the answer, and clicks submit. The bot resumes instantly.
6. **Completion:** Once successful, the bot extracts the generated TRN (Temporary Reference Number), saves it to the database, and closes the browser.

---

## ⚠️ Important Notes

- **Environment Variables:** Never commit `config.js` or `.env` files containing your Supabase keys to public repositories.
- **Data Privacy:** All sensitive documents (proof of constitution, promoter photos) uploaded during the application process are handled securely via local backend storage.
- **Portal Changes:** The official GST portal's DOM structure may change over time. If the automation bot starts failing at specific steps, the Playwright selectors in `runner.js` will need to be updated.
