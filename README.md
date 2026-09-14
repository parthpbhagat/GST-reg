# GST Registration Automation Pipeline

This project is an end-to-end automation solution designed to streamline and automate the GST registration process on the official portal. It features a modern web dashboard for managing applications and a powerful backend-driven headless browser pipeline.

## System Architecture

The project is divided into three main components:

1. **Frontend (`/frontend`)**
   - Built with Vite and React.
   - Provides a beautiful, responsive user interface to view pending applications.
   - Integrates a real-time console view to monitor the Playwright automation process.
   - Allows users to securely provide necessary manual inputs (like CAPTCHA and OTPs) during the automation run.

2. **Backend (`/backend`)**
   - Built with Node.js, Express, and SQLite.
   - Acts as the central hub, managing application data and file uploads (proofs, photos).
   - Dynamically spawns and orchestrates the Playwright automation script.
   - Uses Socket.io to stream real-time logs and CAPTCHA images to the frontend.

3. **Automation (`/automation`)**
   - Built with Playwright.
   - Automates the tedious data entry process on the official GST portal.
   - Robustly handles dynamic elements, timeouts, and form validation logic (including robust retry loops for invalid CAPTCHAs and OTPs).

---

## Getting Started

To run the project locally, you will need to start both the backend server and the frontend development server.

### Prerequisites
- Node.js installed on your machine.

### 1. Start the Backend
The backend must be running to serve the API and trigger the automation scripts.

```bash
cd backend
npm install
node server.js
```
The backend server will run on `http://localhost:3000`.

### 2. Start the Frontend
The frontend provides the user interface for interacting with the pipeline. Open a **new terminal window** and run:

```bash
cd frontend
npm install
npm run dev
```
The frontend web app will run on `http://localhost:5173`.

---

## Usage

1. Navigate to **`http://localhost:5173`** in your web browser.
2. Select an application from the dashboard that is pending registration.
3. Click the button to start the automation pipeline.
4. The system will launch a Playwright instance in the background and begin filling out the GST registration forms.
5. When the pipeline encounters a CAPTCHA or requires an OTP, it will pause and prompt you directly within the frontend interface. Enter the required information, and the pipeline will automatically resume.
6. Temporary files (like uploaded PDFs and images) are automatically managed during the session.

---

## Important Notes

- **Git Tracking:** Git tracking has been intentionally removed from this project per user preference.
- **Data Privacy:** All documents (proof of constitution, promoter photos) uploaded during the automation process are handled securely via local backend storage.
- **Robust Retries:** The pipeline is equipped with robust retry loops. If an incorrect OTP or CAPTCHA is entered, the automation will safely clear the fields and prompt you again without crashing the flow.
