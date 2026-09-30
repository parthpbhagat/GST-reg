const fs = require('fs');
let html = fs.readFileSync('Presentation_Script_Dramatic.html', 'utf8');

// Replace Placeholder 1
html = html.replace(/<img src="https:\/\/placehold\.co\/700x350\/1e293b\/ffffff\?text=Screenshot:\+Frontend\+Applicant\+Wizard"[\s\S]*?<\/p>/, '<img src="screenshot_signin.png" alt="Frontend Wizard Screenshot" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #cbd5e1;">');

// Replace Placeholder 2
html = html.replace(/<img src="https:\/\/placehold\.co\/700x350\/1e293b\/ffffff\?text=Screenshot:\+Admin\+Dashboard\+%26\+Applications\+List"[\s\S]*?<\/p>/, '<img src="screenshot_admin.png" alt="Admin Dashboard Screenshot" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #cbd5e1;">');

// Replace Placeholder 3
html = html.replace(/<img src="https:\/\/placehold\.co\/700x350\/0f172a\/4ade80\?text=Screenshot:\+Live\+Automation\+Terminal"[\s\S]*?<\/p>/, '<img src="screenshot_terminal_captcha.png" alt="Automation Terminal Screenshot" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid #334155;">');

// Replace Placeholder 4
html = html.replace(/<img src="https:\/\/placehold\.co\/700x250\/1e293b\/ffffff\?text=Screenshot:\+CAPTCHA\+or\+OTP\+Prompt"[\s\S]*?<\/p>/, '<img src="screenshot_terminal_otp.png" alt="OTP Screenshot" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #cbd5e1;">');

fs.writeFileSync('Presentation_Script_Dramatic.html', html);
console.log('HTML updated');
