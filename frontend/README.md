# GST Registration Portal - Frontend Integration Guide

This document outlines the data structure of the GST Registration form to easily integrate it with any backend API (Node.js, Python/Django, Java, etc.). 

## How It Works
The entire application state is stored locally in the browser memory within a single `form` object in `script.js`. 
At the final "Review" step, you can trigger an HTTP POST request to your backend by sending this `form` object as a JSON payload.

## Form Data Structure (Payload)
When the user completes the application, the payload that should be sent to your backend will look exactly like this:

```json
{
  "taxpayerType": "Regular Taxpayer", 
  "legalName": "", 
  "tradeName": "", 
  "pan": "", 
  "email": "", 
  "mobile": "", 
  "state": "", 
  "district": "",
  
  "businessConstitution": "", 
  "businessDistrict": "",
  "dateOfCommencement": "", 
  "reasonToObtainRegistration": "Threshold Exceeded",
  
  "ppob_country": "India", 
  "ppob_pincode": "", 
  "ppob_state": "", 
  "ppob_district": "", 
  "ppob_city": "",
  "ppob_locality": "", 
  "ppob_building": "", 
  "ppob_floor": "", 
  "ppob_street": "", 
  "ppob_landmark": "",

  "promoters": [
    { 
      "name": "", 
      "pan": "", 
      "mobile": "", 
      "email": "" 
    }
  ],
  
  "authSig_name": "", 
  "authSig_pan": "", 
  "authSig_mobile": "",
  
  "stateSpecific_electricityBoard": "", 
  "stateSpecific_electricityConsumerNo": "",
  
  "declarantName": "", 
  "place": ""
}
```

## Field Dictionary

### Taxpayer Information
* `taxpayerType` (String): e.g., 'Regular Taxpayer', 'Composition Taxpayer', 'Casual Taxable Person'
* `legalName` (String): Legal name of the business
* `tradeName` (String): Trade name
* `pan` (String): 10-character alphanumeric PAN
* `email` (String): Valid email address
* `mobile` (String): 10-digit mobile number
* `state` (String): Selected state
* `district` (String): Selected district (depends on state)

### Business Details
* `businessConstitution` (String): e.g., 'Proprietorship', 'Partnership Firm', 'Private Limited Company'
* `dateOfCommencement` (String): YYYY-MM-DD date format
* `reasonToObtainRegistration` (String): e.g., 'Threshold Exceeded', 'Inter-State Supply'

### Principal Place of Business (PPOB)
* `ppob_country` (String): Default is 'India'
* `ppob_pincode` (String): 6-digit Pincode
* `ppob_state` (String): Selected PPOB State
* `ppob_district` (String): Selected PPOB District
* `ppob_city` (String): City/Town/Village
* `ppob_locality` (String): Locality/Sub Locality
* `ppob_building` (String): Name of Premises/Building
* `ppob_floor` (String): Floor No.
* `ppob_street` (String): Road/Street
* `ppob_landmark` (String): Landmark (optional)

### Promoters / Partners / Directors
* `promoters` (Array of Objects): Contains objects with `name`, `pan`, `mobile`, and `email`. (Currently captures 1 promoter)

### Authorized Signatory
* `authSig_name` (String): Full name
* `authSig_pan` (String): 10-character PAN
* `authSig_mobile` (String): 10-digit Mobile

### State Specific Information
* `stateSpecific_electricityBoard` (String): E.g., 'Torrent Power'
* `stateSpecific_electricityConsumerNo` (String): Consumer number

### Declaration
* `declarantName` (String): Name of the declarant
* `place` (String): Place where the form is signed/submitted

## Example Integration
To send this to your backend, you can update the button on **Step 8 (Review)** in `script.js` to look like this:

```javascript
// Add this inside the Step 8 render logic in script.js
function submitData() {
    fetch('https://your-backend-api.com/api/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(form)
    })
    .then(response => response.json())
    .then(data => {
        alert("Form Submitted Successfully to Backend!");
    })
    .catch(error => {
        console.error("Error submitting form:", error);
        alert("Failed to submit form.");
    });
}
```

Then change the Complete Application button HTML in step 8 to:
```html
<button class="btn accent" onclick="submitData()">Complete Application</button>
```
