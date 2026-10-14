# 🇮🇳 GST Registration Automation Platform
> **GST નવા રજીસ્ટ્રેશનની સંપૂર્ણ ઓટોમેટેડ પ્રક્રિયા (End-to-End Automated GST Registration Solution)**

---

## 🌟 સરળ ભાષામાં પ્રોજેક્ટની સમજૂતી (Simple Project Explanation)

આ પ્રોજેક્ટ ભારત સરકારના સત્તાવાર GST પોર્ટલ (**reg.gst.gov.in**) પર નવી GST અરજી (New GST Registration) કરવાની પ્રક્રિયાને **૧૦૦% ઓટોમેટિક** બનાવે છે.

### 📌 સામાન્ય પ્રક્રિયા વિરુદ્ધ આપણી ઓટોમેશન સિસ્ટમ:
* **સામાન્ય રીતે (Manual Process):** કોઈપણ CA, એકાઉન્ટન્ટ કે વ્યાપારીને GST પોર્ટલ પર જઈને ૧૦ અલગ-અલગ ટેબ્સ (Business Details, Promoters, Signatory, Address, HSN, Aadhaar વગેરે) માં હાથેથી માહિતી ટાઈપ કરવી પડે છે અને દસ્તાવેજો અપલોડ કરવા પડે છે, જેમાં ૩૦ થી ૪૫ મિનિટનો સમય બગડે છે અને ભૂલ થવાની સંભાવના રહે છે.
* **આપણા પ્લેટફોર્મ દ્વારા (Our Automated System):** 
  1. અરજદાર અમારા સરળ પોર્ટલ પર એકવાર ફોર્મ ભરે છે.
  2. સિસ્ટમ આપમેળે આધાર/પાન કાર્ડમાંથી OCR દ્વારા ડેટા ખેંચી લે છે.
  3. એડમિન માત્ર એક ક્લિક (`Register Automatically`) કરે છે.
  4. અમારો **Playwright Automation Bot** આપમેળે સરકારી પોર્ટલ ખોલીને બધો જ ડેટા સીધો સેકન્ડોમાં પોર્ટલ પર ભરી દે છે અને Verification સ્ક્રીન પર પહોંચીને **Submit with EVC** ક્લિક કરી દે છે.
  5. અરજદારના મોબાઈલ પર આવતો OTP એડમિન સ્ક્રીન પર નાખતા જ અરજી સબમિટ થઈ જાય છે અને **ARN નંબર** જનરેટ થઈ જાય છે!

---

## 🏗️ પ્રોજેક્ટ આર્કિટેક્ચર (Project Architecture)

પ્રોજેક્ટ મુખ્ય ત્રણ ભાગોમાં વહેંચાયેલો છે:

```
[ Frontend (Client Form & Admin) ]  <---> [ Backend (Node.js & Express) ]  <---> [ Automation Bot (Playwright) ]
        (Port: 5173)                                (Port: 3002)                          (reg.gst.gov.in)
              |                                            |
              +-------------------> [ Supabase Database ] -+
```

### ૧. Frontend (`/frontend`) - ક્લાયન્ટ ઇન્ટરફેસ & એડમિન પેનલ
* **ટેકનોલોજી:** HTML5, CSS3, JavaScript (Vanilla), Vite.
* **કાર્યો:**
  * **Applicant Wizard:** અરજદાર માટે સ્ટેપ-બાય-સ્ટેપ ૧૦ સ્ટેપનું સુંદર અને મોબાઇલ-ફ્રેન્ડલી ફોર્મ.
  * **Client-side OCR:** પાન કાર્ડ અને આધાર કાર્ડમાંથી આપમેળે નામ, નંબર અને પિનકોડ વાંચી લે છે.
  * **Mappls (MapmyIndia) Integration:** નકશા પર ક્લિક કરીને અથવા પિનકોડ નાખીને સરનામું, અક્ષાંશ-રેખાંશ અને જ્યુરિડિક્શન આપમેળે મેળવે છે.
  * **Admin Dashboard:** આવેલી અરજીઓ જોવી, મંજૂર/નામંજૂર કરવી અને ઓટોમેશન શરૂ કરવું.
  * **Live Console Modal:** ઓટોમેશન દરમિયાન બ્રાઉઝરની લાઇવ સ્ક્રીન, કેપ્ચા અને OTP દાખલ કરવા માટેનું ઇન્ટરેક્ટિવ મોડલ.

### ૨. Backend API (`/backend`) - સેન્ટ્રલ સર્વર & ડેટાબેઝ
* **ટેકનોલોજી:** Node.js, Express, Socket.IO, Supabase, SQLite.
* **કાર્યો:**
  * તમામ અરજીઓનો ડેટા સુરક્ષિત સંગ્રહ કરવો.
  * અપલોડ કરેલા મોટા ફોટા અને દસ્તાવેજોને લોકલ ડિરેક્ટરી (`backend/data/...`) માં સાચવવા.
  * **GST Payload Builder (`gst_payload_builder.js`):** ક્લાયન્ટના ડેટામાંથી GST પોર્ટલ સ્વીકારે તેવું સત્તાવાર JSON સ્ટ્રક્ચર તૈયાર કરવું.
  * **Socket.IO Real-time Pipeline:** ઓટોમેશન બોટમાંથી લાઇવ લૉગ્સ, સ્ક્રીનશોટ અને કેપ્ચા ઈમેજીસ એડમિનના બ્રાઉઝર સુધી સેકન્ડના દસમા ભાગમાં પહોંચાડવા.

### ૩. Automation Bot (`/automation/runner.js`) - રોબોટિક બોટ
* **ટેકનોલોજી:** Playwright (Chromium Headless/Headful Browser Automation).
* **કાર્યો:**
  * પોર્ટલ પર જવું, Part A માં TRN બનાવવો અને TRN OTP લૉગિન કરવું.
  * સત્તાવાર JSON સીધું જ પોર્ટલના એન્ડપોઇન્ટ પર સિંક્રોનાઇઝ કરવું.
  * Business Details (Constitution, Reason, Date of Commencement) ઑટો-ફિલ કરવી.
  * ૧૦ વિઝાર્ડ ટેબ્સમાંથી પસાર થઈને Verification સ્ક્રીન પર Declaration, Signatory અને Place કન્ફર્મ કરીને **Submit with EVC** બટન દબાવવું.
  * એડમિન પાસેથી EVC OTP મેળવીને સબમિટ કરવું અને મેળવેલ ARN નંબર ડેટાબેઝમાં સેવ કરવો.

---

## 🔄 ઓટોમેશનના ૫ મુખ્ય પગલાં (The 5 Pipeline Steps)

1. **પગલું ૧: TRN Generation & Login**  
   અરજદારના પાન, ઇમેઇલ અને મોબાઇલ દ્વારા Part A ફોર્મ ભરીને TRN નંબર જનરેટ કરવો અને લૉગિન કરવું. જો અરજી પાસે પહેલેથી TRN હોય, તો સીધું TRN લૉગિન સ્ક્રીન પર પહોંચી જવું.
2. **પગલું ૨: વચ્ચેના સ્ટેપ SKIP**  
   હાથેથી ફોર્મ ભરવાને બદલે અગાઉથી તૈયાર સત્તાવાર ડેટાનો ઉપયોગ કરવો.
3. **પગલું ૩: Direct JSON Upload & Synchronization**  
   સંપૂર્ણ એપ્લિકેશન ડેટા (`gst_final_uploaded_payload.json`) સીધો જ પોર્ટલના વેલિડેશન એન્ડપોઇન્ટ પર મોકલવો.
4. **પગલું ૪: Business Details & Verification Screen Navigation**  
   Business Details માં Constitution, Reason, Commencement Date અને Liability Date ભરીને Verification ટેબ પર પહોંચવું.
5. **પગલું ૫: EVC OTP Submission & Final ARN Generation**  
   Declaration અને Signatory સિલેક્ટ કરી **SUBMIT WITH EVC** ક્લિક કરવું. પોર્ટલ દ્વારા મોકલેલ OTP દાખલ કરતાં જ અરજી કાયમી માટે જમા થઈને ARN (Application Reference Number) મળી જશે.

---

## 🚀 પ્રોજેક્ટ કેવી રીતે ચલાવવો (How to Run Locally)

### જરૂરિયાતો (Prerequisites)
* Node.js (v18 અથવા તેથી વધુ)
* Supabase એકાઉન્ટ (credentials `.env` માં સેટ કરેલા હોવા જોઈએ)

### ૧. Backend સર્વર શરૂ કરો:
નવું ટર્મિનલ ખોલો અને નીચેનો કમાન્ડ ચલાવો:
```bash
node backend/server.js
```
*બેકએન્ડ સર્વર પોર્ટ `3002` પર સક્રિય થશે.*

### ૨. Frontend ક્લાયન્ટ શરૂ કરો:
બીજું ટર્મિનલ ખોલો અને નીચેનો કમાન્ડ ચલાવો:
```bash
cd frontend
npm run dev
```
*ફ્રન્ટએન્ડ `http://localhost:5173` પર ઉપલબ્ધ થશે.*

---

## 🛡️ તાજેતરમાં સોલ્વ કરવામાં આવેલી ખામીઓ (Recent Fixes)
1. **Date of Commencement Validation:** પોર્ટલના Angular UI-Bootstrap Datepicker ઇનપુટ (`#cmbzdt`) ને સીધા ID/name દ્વારા લોકેટ કરીને કીસ્ટ્રોક્સ અને Angular `$setViewValue` સાથે સિંક કર્યું.
2. **False-Positive File Size Error:** પોર્ટલના પ્રોમોટર ટેબ પર આવતી કાયમી સૂચનાઓને ઇગ્નોર કરવા માટે યુનિફાઇડ ફિલ્ટર લગાવ્યું.
3. **Authorized Signatory & Submit with EVC:** Verification સ્ક્રીન પર Authorized Signatory નું સાચું ડ્રોપડાઉન સિલેક્ટ કરીને **SUBMIT WITH EVC** બટન ટ્રિગર કરવામાં આવ્યું, તથા સત્તાવાર OTP API સાથે સીધું ફોલબેક કનેક્શન સેટ કર્યું.

---

## 📄 લાયસન્સ (License)
આ પ્રોજેક્ટ આંતરિક વ્યવસાયિક ઓટોમેશન માટે તૈયાર કરવામાં આવ્યો છે.
