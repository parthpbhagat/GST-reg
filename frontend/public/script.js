const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3002' : 'https://YOUR_BACKEND_URL.onrender.com';

const mapplsService = {
    parseAddressComponents(data) {
        return {
            state: data.state || '',
            district: data.district || '',
            city: data.city || data.village || data.town || '',
            locality: data.locality || data.subDistrict || data.subLocality || '',
            street: data.street || data.poi || '',
            postcode: data.pincode || '',
            lat: data.latitude || data.lat || null,
            lon: data.longitude || data.lng || null
        };
    },

    async autocomplete(text) {
        if (!text || text.length < 3 || !window.mappls || !window.mappls.search) return [];

        return new Promise((resolve) => {
            try {
                mappls.search({ keyword: text, plugin: false }, function (data) {
                    if (data && data.length > 0) {
                        resolve(data.map(p => ({
                            properties: {
                                formatted: p.placeName + (p.placeAddress ? ', ' + p.placeAddress : ''),
                                place_id: p.eLoc,
                                name: p.placeName,
                                state: p.state,
                                district: p.district,
                                city: p.city || p.village || p.town,
                                locality: p.locality || p.subDistrict,
                                street: p.street || p.poi,
                                postcode: p.pincode
                            }
                        })));
                    } else {
                        resolve([]);
                    }
                });
            } catch (e) {
                console.error('Mappls autocomplete error:', e);
                resolve([]);
            }
        });
    },

    async reverseGeocode(lat, lon) {
        if (!window.mappls || !window.mappls.revCode) return null;
        return new Promise((resolve) => {
            try {
                mappls.revCode({ lat: lat, lng: lon }, function (data) {
                    if (data && data.length > 0) {
                        const parsed = mapplsService.parseAddressComponents(data[0]);
                        parsed.lat = lat;
                        parsed.lon = lon;
                        resolve(parsed);
                    } else {
                        resolve(null);
                    }
                });
            } catch (e) {
                console.error('Mappls revCode error:', e);
                resolve(null);
            }
        });
    },

    async geocodePlaceId(eloc) {
        // Mappls Map JS SDK handles placing markers via eLoc easily, but if we want the actual lat/lng
        // we can use mappls.getPinDetails if available, or just map.panTo(). 
        // For now, if the autocomplete results already gave us the required info, we might not strictly need this,
        // but let's implement a fallback just in case, though the SDK doesn't natively expose a simple getPinDetails via plugin
        // without placing a marker.
        return null;
    },

    async searchPincode(pincode) {
        if (!pincode || pincode.length !== 6) return [];
        return this.autocomplete(pincode);
    }
};

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const STATE_DATA = [
    {
        "state": "Andaman and Nicobar Islands",
        "districts": ["Nicobar", "North and Middle Andaman", "South Andaman"]
    },
    {
        "state": "Ladakh",
        "districts": ["Kargil", "Leh"]
    },
    {
        "state": "Andhra Pradesh",
        "districts": [
            "Anantapur", "Chittoor", "East Godavari", "Guntur", "Krishna",
            "Kurnool", "Nellore", "Prakasam", "Srikakulam", "Visakhapatnam",
            "Vizianagaram", "West Godavari", "YSR Kadapa"
        ]
    },
    {
        "state": "Arunachal Pradesh",
        "districts": [
            "Tawang", "West Kameng", "East Kameng", "Papum Pare", "Kurung Kumey",
            "Kra Daadi", "Lower Subansiri", "Upper Subansiri", "West Siang",
            "East Siang", "Siang", "Upper Siang", "Lower Siang", "Lower Dibang Valley",
            "Dibang Valley", "Anjaw", "Lohit", "Namsai", "Changlang", "Tirap", "Longding"
        ]
    },
    {
        "state": "Assam",
        "districts": [
            "Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo",
            "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Goalpara",
            "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup Metropolitan",
            "Kamrup", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur",
            "Majuli", "Morigaon", "Nagaon", "Nalbari", "Dima Hasao", "Sivasagar",
            "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri", "West Karbi Anglong"
        ]
    },
    {
        "state": "Bihar",
        "districts": [
            "Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur",
            "Bhojpur", "Buxar", "Darbhanga", "East Champaran (Motihari)", "Gaya",
            "Gopalganj", "Jamui", "Jehanabad", "Kaimur (Bhabua)", "Katihar",
            "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani",
            "Munger (Monghyr)", "Muzaffarpur", "Nalanda", "Nawada", "Patna",
            "Purnia (Purnea)", "Rohtas", "Saharsa", "Samastipur", "Saran",
            "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali",
            "West Champaran"
        ]
    },
    {
        "state": "Chandigarh (UT)",
        "districts": [
            "Chandigarh"
        ]
    },
    {
        "state": "Chhattisgarh",
        "districts": [
            "Balod", "Baloda Bazar", "Balrampur", "Bastar", "Bemetara", "Bijapur",
            "Bilaspur", "Dantewada (South Bastar)", "Dhamtari", "Durg", "Gariyaband",
            "Janjgir-Champa", "Jashpur", "Kabirdham (Kawardha)", "Kanker (North Bastar)",
            "Kondagaon", "Korba", "Korea (Koriya)", "Mahasamund", "Mungeli",
            "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sukma", "Surajpur  ", "Surguja"
        ]
    },
    {
        "state": "Dadra and Nagar Haveli (UT)",
        "districts": [
            "Dadra & Nagar Haveli"
        ]
    },
    {
        "state": "Daman and Diu (UT)",
        "districts": [
            "Daman", "Diu"
        ]
    },
    {
        "state": "Delhi (NCT)",
        "districts": [
            "Central Delhi", "East Delhi", "New Delhi", "North Delhi",
            "North East  Delhi", "North West  Delhi", "Shahdara", "South Delhi",
            "South East Delhi", "South West  Delhi", "West Delhi"
        ]
    },
    {
        "state": "Goa",
        "districts": [
            "North Goa", "South Goa"
        ]
    },
    {
        "state": "Gujarat",
        "districts": [
            "Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha (Palanpur)",
            "Bharuch", "Bhavnagar", "Botad", "Chhota Udepur", "Dahod", "Dangs (Ahwa)",
            "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh",
            "Kachchh", "Kheda (Nadiad)", "Mahisagar", "Mehsana", "Morbi",
            "Narmada (Rajpipla)", "Navsari", "Panchmahal (Godhra)", "Patan",
            "Porbandar", "Rajkot", "Sabarkantha (Himmatnagar)", "Surat",
            "Surendranagar", "Tapi (Vyara)", "Vadodara", "Valsad"
        ]
    },
    {
        "state": "Haryana",
        "districts": [
            "Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurgaon",
            "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra",
            "Mahendragarh", "Mewat", "Palwal", "Panchkula", "Panipat", "Rewari",
            "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"
        ]
    },
    {
        "state": "Himachal Pradesh",
        "districts": [
            "Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu",
            "Lahaul &amp; Spiti", "Mandi", "Shimla", "Sirmaur (Sirmour)", "Solan", "Una"
        ]
    },
    {
        "state": "Jammu and Kashmir",
        "districts": [
            "Anantnag", "Bandipore", "Baramulla", "Budgam", "Doda", "Ganderbal",
            "Jammu", "Kargil", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Leh",
            "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian",
            "Srinagar", "Udhampur"
        ]
    },
    {
        "state": "Jharkhand",
        "districts": [
            "Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum",
            "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribag", "Jamtara", "Khunti",
            "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi",
            "Sahibganj", "Seraikela-Kharsawan", "Simdega", "West Singhbhum"
        ]
    },
    {
        "state": "Karnataka",
        "districts": [
            "Bagalkot", "Ballari (Bellary)", "Belagavi (Belgaum)",
            "Bengaluru (Bangalore) Rural", "Bengaluru (Bangalore) Urban", "Bidar",
            "Chamarajanagar", "Chikballapur", "Chikkamagaluru (Chikmagalur)",
            "Chitradurga", "Dakshina Kannada", "Davangere", "Dharwad", "Gadag",
            "Hassan", "Haveri", "Kalaburagi (Gulbarga)", "Kodagu", "Kolar", "Koppal",
            "Mandya", "Mysuru (Mysore)", "Raichur", "Ramanagara", "Shivamogga (Shimoga)",
            "Tumakuru (Tumkur)", "Udupi", "Uttara Kannada (Karwar)",
            "Vijayapura (Bijapur)", "Yadgir"
        ]
    },
    {
        "state": "Kerala",
        "districts": [
            "Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam",
            "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta",
            "Thiruvananthapuram", "Thrissur", "Wayanad"
        ]
    },
    {
        "state": "Lakshadweep (UT)",
        "districts": [
            "Agatti", "Amini", "Androth", "Bithra", "Chethlath", "Kavaratti",
            "Kadmath", "Kalpeni", "Kilthan", "Minicoy"
        ]
    },
    {
        "state": "Madhya Pradesh",
        "districts": [
            "Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani",
            "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara",
            "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda",
            "Hoshangabad", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa",
            "Khargone", "Mandla", "Mandsaur", "Morena", "Narsinghpur", "Neemuch",
            "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna",
            "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi",
            "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha"
        ]
    },
    {
        "state": "Maharashtra",
        "districts": [
            "Ahmednagar", "Akola", "Amravati", "Aurangabad", "Beed", "Bhandara",
            "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia", "Hingoli",
            "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City", "Mumbai Suburban",
            "Nagpur", "Nanded", "Nandurbar", "Nashik", "Osmanabad", "Palghar",
            "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg",
            "Solapur", "Thane", "Wardha", "Washim", "Yavatmal"
        ]
    },
    {
        "state": "Manipur",
        "districts": [
            "Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West",
            "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl",
            "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"
        ]
    },
    {
        "state": "Meghalaya",
        "districts": [
            "East Garo Hills", "East Jaintia Hills", "East Khasi Hills",
            "North Garo Hills", "Ri Bhoi", "South Garo Hills",
            "South West Garo Hills ", "South West Khasi Hills", "West Garo Hills",
            "West Jaintia Hills", "West Khasi Hills"
        ]
    },
    {
        "state": "Mizoram",
        "districts": [
            "Aizawl", "Champhai", "Kolasib", "Lawngtlai", "Lunglei", "Mamit",
            "Saiha", "Serchhip"
        ]
    },
    {
        "state": "Nagaland",
        "districts": [
            "Dimapur", "Kiphire", "Kohima", "Longleng", "Mokokchung", "Mon",
            "Peren", "Phek", "Tuensang", "Wokha", "Zunheboto"
        ]
    },
    {
        "state": "Odisha",
        "districts": [
            "Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh", "Cuttack",
            "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghapur", "Jajpur",
            "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Kendujhar (Keonjhar)",
            "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur",
            "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Sonepur", "Sundargarh"
        ]
    },
    {
        "state": "Puducherry (UT)",
        "districts": [
            "Karaikal", "Mahe", "Pondicherry", "Yanam"
        ]
    },
    {
        "state": "Punjab",
        "districts": [
            "Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib",
            "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar",
            "Kapurthala", "Ludhiana", "Mansa", "Moga", "Muktsar",
            "Nawanshahr (Shahid Bhagat Singh Nagar)", "Pathankot", "Patiala",
            "Rupnagar", "Sahibzada Ajit Singh Nagar (Mohali)", "Sangrur", "Tarn Taran"
        ]
    },
    {
        "state": "Rajasthan",
        "districts": [
            "Ajmer", "Alwar", "Banswara", "Baran", "Barmer", "Bharatpur", "Bhilwara",
            "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Dholpur",
            "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar",
            "Jhunjhunu", "Jodhpur", "Karauli", "Kota", "Nagaur", "Pali", "Pratapgarh",
            "Rajsamand", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar",
            "Tonk", "Udaipur"
        ]
    },
    {
        "state": "Sikkim",
        "districts": [
            "East Sikkim", "North Sikkim", "South Sikkim", "West Sikkim"
        ]
    },
    {
        "state": "Tamil Nadu",
        "districts": [
            "Ariyalur", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri",
            "Dindigul", "Erode", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri",
            "Madurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur",
            "Pudukkottai", "Ramanathapuram", "Salem", "Sivaganga", "Thanjavur",
            "Theni", "Thoothukudi (Tuticorin)", "Tiruchirappalli", "Tirunelveli",
            "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore",
            "Viluppuram", "Virudhunagar"
        ]
    },
    {
        "state": "Telangana",
        "districts": [
            "Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon",
            "Jayashankar Bhoopalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar",
            "Khammam", "Komaram Bheem Asifabad", "Mahabubabad", "Mahabubnagar",
            "Mancherial", "Medak", "Medchal", "Nagarkurnool", "Nalgonda", "Nirmal",
            "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy",
            "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal (Rural)",
            "Warangal (Urban)", "Yadadri Bhuvanagiri"
        ]
    },
    {
        "state": "Tripura",
        "districts": [
            "Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala",
            "South Tripura", "Unakoti", "West Tripura"
        ]
    },
    {
        "state": "Uttarakhand",
        "districts": [
            "Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar",
            "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal",
            "Udham Singh Nagar", "Uttarkashi"
        ]
    },
    {
        "state": "Uttar Pradesh",
        "districts": [
            "Agra", "Aligarh", "Allahabad", "Ambedkar Nagar",
            "Amethi (Chatrapati Sahuji Mahraj Nagar)", "Amroha (J.P. Nagar)", "Auraiya",
            "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda",
            "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Budaun",
            "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah",
            "Faizabad", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar",
            "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur",
            "Hapur (Panchsheel Nagar)", "Hardoi", "Hathras", "Jalaun", "Jaunpur",
            "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar",
            "Kanshiram Nagar (Kasganj)", "Kaushambi", "Kushinagar (Padrauna)",
            "Lakhimpur - Kheri", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba",
            "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad",
            "Muzaffarnagar", "Pilibhit", "Pratapgarh", "RaeBareli", "Rampur",
            "Saharanpur", "Sambhal (Bhim Nagar)", "Sant Kabir Nagar", "Shahjahanpur",
            "Shamali (Prabuddh Nagar)", "Shravasti", "Siddharth Nagar", "Sitapur",
            "Sonbhadra", "Sultanpur", "Unnao", "Varanasi"
        ]
    },
    {
        "state": "West Bengal",
        "districts": [
            "Alipurduar", "Bankura", "Birbhum", "Burdwan (Bardhaman)", "Cooch Behar",
            "Dakshin Dinajpur (South Dinajpur)", "Darjeeling", "Hooghly", "Howrah",
            "Jalpaiguri", "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia",
            "North 24 Parganas", "Paschim Medinipur (West Medinipur)",
            "Purba Medinipur (East Medinipur)", "Purulia", "South 24 Parganas",
            "Uttar Dinajpur (North Dinajpur)"
        ]
    }
];

const STATES = STATE_DATA.map(s => s.state);

function getDistricts(stateName) {
    if (!stateName) return [];
    if (window.fetchedDistricts && window.fetchedDistricts[stateName]) {
        return window.fetchedDistricts[stateName];
    }
    return [];
}

const BUSINESS_TYPES = [
    "Foreign Company",
    "Foreign Limited Liability Partnership",
    "Government Department",
    "Hindu Undivided Family",
    "Limited Liability Partnership",
    "Local Authority",
    "Others",
    "Partnership",
    "Private Limited Company",
    "Proprietorship",
    "Public Limited Company",
    "Public Sector Undertaking",
    "Society/ Club/ Trust/ AOP",
    "Statutory Body",
    "Unlimited Company"
];

const REGISTRATION_REASONS = [
    "Crossing the Threshold",
    "Inter-State supply",
    "Liability to pay as recipient of goods or services",
    "Transfer / Succession of business",
    "Death of the Proprietor",
    "De-merger",
    "Change in constitution of business",
    "Merger /Amalgamation",
    "E-Commerce Operator",
    "Selling through e-Commerce portal",
    "Voluntary Basis",
    "Input Service Distributor only",
    "Supplies on behalf of other taxable Person",
    "Others"
];

const EXISTING_REGISTRATION_TYPES = [
    "GSTIN",
    "Temporary ID",
    "Registration Number under Value Added Tax (TIN)",
    "Central Sales Tax Registration Number",
    "Central Excise Registration Number",
    "Service Tax Registration Number",
    "Importer/Exporter Code Number",
    "Entry Tax Registration Number",
    "Entertainment Tax Registration Number",
    "Hotel And Luxury Tax Registration Number",
    "Corporate Identity Number / Foreign Company Registration Number",
    "Limited Liability Partnership / Foreign Limited Liability Partnership Identification Number",
    "Registration number under Medicinal and Toilet Preparations (Excise Duties) Act",
    "Registration under Shops and Establishment Act",
    "Others (Please specify)"
];

const ELECTRICITY_BOARDS = {
    "Gujarat": ["Dakshin Gujarat Vij Company Limited", "Gift Power Company Limited", "Madhya Gujarat Vij Company Limited", "Paschim Gujarat Vij Company Limited", "Torrent Power Limited", "Uttar Gujarat Vij Company Limited"],
    "Andhra Pradesh": ["Central Power Distribution Company of Andra Pradesh Limited", "Eastern Power Distribution Company of Andra Pradesh Limited", "Southern Power Distribution Company of Andra Pradesh Limited"],
    "Assam": ["Assam Power Distribution Company Limited"],
    "Maharashtra": ["Adani Electricity mumbai Limited", "Maharashtra State Electricity Distribution Co.Ltd", "Tata Power", "The Brihanmumbai Electric Supply and Transport Undertaking", "Torrent Power Limited"],
    "Madhya Pradesh": ["MP Madhya Kshetra Vidyut Vitaran Co.Ltd", "MP Paschim Kshetra Vidyut Vitaran Co.Ltd", "MP Poorva Kshetra Vidyut Vitaran Co.Ltd"],
    "Odisha": ["TP Central Odisha Distribution Limited", "TP Northern Odisha Distribution Limited", "TP Southern Odisha Distribution Limited", "TP Western Odisha Distribution Limited"],
    "Rajasthan": ["Ajmer Vidyut Vitran Nigam Limited", "Jaipur Vidyut Vitran Nigam Limited", "Jodhpur Vidyut Vitran Nigam Limited"]
};

const STEPS = [
    "Taxpayer and Business", "Promoters", "Authorized Signatory", "Place",
    "Goods & State Specific", "Review"
];

let step = 0;
let isPreview = false;
let goodsTab = 'goods';
let currentPromoterKey = 'p1';
let isPromoterListView = false;
let currentAuthSigKey = 'a1';
let isAuthSigListView = false;

window.defaultPromoter = {
    firstName: "", middleName: "", lastName: "", fatherFirstName: "", fatherMiddleName: "", fatherLastName: "",
    dob: "", gender: "Male", mobile: "", email: "", stdCode: "", telephone: "",
    designation: "", din: "", citizen: true, pan: "", passport: "", aadhaar: "",
    res_country: "India", res_pincode: "", res_state: "", res_district: "", res_city: "",
    res_locality: "", res_road: "", res_buildingName: "", res_buildingNo: "", res_floor: "", res_landmark: "",
    promoterPhotoFile: "", alsoAuthorizedSignatory: false
};

window.defaultAuthSig = {
    primary: false, firstName: "", middleName: "", lastName: "", fatherFirstName: "", fatherMiddleName: "", fatherLastName: "", dob: "", mobile: "", email: "", gender: "", stdCode: "", telephone: "", designation: "", din: "", pan: "", passport: "", aadhaar: "", res_country: "India", res_pincode: "", res_state: "", res_district: "", res_city: "", res_locality: "", res_road: "", res_buildingName: "", res_buildingNo: "", res_floor: "", res_landmark: "", authSigProofType: "", authSigProofFile: "", authSigPhotoFile: ""
};

window.form = {
    goods_hsn: [], goods_sac: [],
    taxpayerType: "", legalName: "", tradeName: "", pan: "", email: "", mobile: "", state: "", district: "",
    businessConstitution: "", dateOfCommencement: "", dateOfLiability: "", reasonToObtainRegistration: "", businessDistrict: "",
    rule14A: "",
    existingRegistrationType: "", existingRegistrationNo: "", existingRegistrationDate: "",
    proofOfConstitutionType: "", proofOfConstitutionFile: "", documentForTradeNameFile: "",
    ppob_building: "", ppob_flatNo: "", ppob_floor: "", ppob_street: "", ppob_locality: "", ppob_city: "",
    ppob_state: "", ppob_district: "", ppob_pincode: "", ppob_country: "India", ppob_landmark: "", ppob_latitude: "", ppob_longitude: "",
    ppob_stateJurisdiction: "", ppob_commissionerate: "", ppob_division: "", ppob_range: "",
    ppob_email: "", ppob_stdCode: "", ppob_telephone: "", ppob_mobile: "", ppob_faxStdCode: "", ppob_fax: "",
    ppob_natureOfPossession: "", ppob_doc: "", ppob_docFile: "",
    ppob_natureOfBusiness: { bondedWarehouse: false, factoryManufacturing: false, leasingBusiness: false, retailBusiness: false, worksContract: false, eouStpEhtp: false, import: false, officeSaleOffice: false, warehouseDepot: false, others: false, export: false, supplierOfServices: false, recipientOfGoodsOrServices: false, wholesaleBusiness: false },
    p1: JSON.parse(JSON.stringify(window.defaultPromoter)),
    a1: JSON.parse(JSON.stringify(window.defaultAuthSig)),
    stateSpecific_electricityBoard: "", stateSpecific_electricityConsumerNo: "",
    stateSpecific_ptEcNo: "", stateSpecific_ptRcNo: "",
    stateSpecific_exciseLicenseNo: "", stateSpecific_exciseLicenseHolder: ""
};

function renderSidebar() {
    const sidebar = document.getElementById('wizard-steps');
    if (!sidebar) return;
    sidebar.innerHTML = STEPS.map((label, idx) => {
        let status = 'upcoming';
        if (idx === step) status = 'active';
        else if (idx < step) status = 'completed';
        return `
            <button type="button" id="step-btn-${idx}" class="wizard-step-btn ${status}" onclick="setStep(${idx})">
                <span class="step-circle">${idx + 1}</span>
                <span class="step-name">${label}</span>
            </button>
        `;
    }).join('');

    const activeBtn = document.getElementById(`step-btn-${step}`);
    if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function setStep(newStep) {
    if (newStep === 2) {
        let hasPromoterAuthSig = false;
        for (let k in window.form) {
            if (k.match(/^p\d+$/) && window.form[k].alsoAuthorizedSignatory) {
                hasPromoterAuthSig = true;
                break;
            }
        }
        if (hasPromoterAuthSig) {
            isAuthSigListView = true;
            window.isViewingPromoter = false;
        }
    }

    step = newStep;
    const header = document.querySelector('header.top');
    if (header) {
        if (step > 0) {
            header.classList.add('hidden');
        } else {
            header.classList.remove('hidden');
        }
    }
    renderSidebar();
    renderContent();
}

function field(label, content, error = '') {
    return `<div class="field"><label>${label}</label>${content}${error ? `<span class="error">${error}</span>` : ''}</div>`;
}

function textInput(key, val, extra = '') {
    return `<input type="text" id="${key}" value="${val || ''}" onchange="updateForm('${key}', this.value)" ${extra} />`;
}

function select(key, val, options, placeholder = '') {
    let opts = placeholder ? `<option value="">${placeholder}</option>` : '';
    opts += options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('');
    return `<select id="${key}" onchange="updateForm('${key}', this.value)">${opts}</select>`;
}

window.updatePanFormatBoxes = function (val) {
    val = val || '';
    for (let i = 0; i < 10; i++) {
        const el = document.getElementById('pan_box_' + i);
        if (!el) continue;

        let isValid = false;
        if (val.length > i) {
            const char = val[i];
            if (i >= 0 && i <= 4) isValid = /^[A-Za-z]$/.test(char);
            if (i >= 5 && i <= 8) isValid = /^[0-9]$/.test(char);
            if (i === 9) isValid = /^[A-Za-z]$/.test(char);
        }

        if (isValid) {
            el.style.backgroundColor = '#4d7c0f';
            el.style.color = 'white';
        } else {
            el.style.backgroundColor = '#fce8e6';
            el.style.color = '#b91c1c';
        }
    }
};

window.updateForm = function (key, value) {
    // Helper to deeply set a value
    const setDeep = (obj, path, val) => {
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = val;
    };

    // Helper to deeply get a value
    const getDeep = (obj, path) => {
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        let current = obj;
        for (let i = 0; i < keys.length; i++) {
            if (current === undefined || current === null) return undefined;
            current = current[keys[i]];
        }
        return current;
    };

    setDeep(window.form, key, value);

    if (key.endsWith('.alsoAuthorizedSignatory')) {
        const pKey = key.split('.')[0];
        if (value) {
            window.form[pKey].authSigTimestamp = Date.now();
        } else {
            delete window.form[pKey].authSigTimestamp;
        }
    }

    // Sync Logic Removed as per user request

    // State & District handling (without syncing to other fields)
    if (key === 'state' || key === 'res_state' || key === 'ppob_state' || key.endsWith('.res_state')) {
        // Reset district when its corresponding state changes
        let districtKeyToReset = '';
        if (key === 'state') {
            districtKeyToReset = 'district';
            setDeep(window.form, 'businessDistrict', ''); // Keep businessDistrict reset as well
        } else if (key === 'res_state') {
            districtKeyToReset = 'res_district';
        } else if (key === 'ppob_state') {
            districtKeyToReset = 'ppob_district';
        } else if (key.endsWith('.res_state')) {
            const prefix = key.substring(0, key.lastIndexOf('.'));
            districtKeyToReset = prefix + '.res_district';
        }

        if (districtKeyToReset) {
            setDeep(window.form, districtKeyToReset, '');
        }

        if (window.fetchAndSetDistricts) window.fetchAndSetDistricts(value, renderContent);
        else renderContent();
    }

    // Existing specific logic
    if (key === 'ppob_natureOfPossession') {
        window.form.ppob_doc = '';
        renderContent();
    } else if (key === 'businessConstitution') {
        renderContent();
    }

    // If Primary Authorized Signatory logic is active, resync Promoter p1 to Auth Sig
    if (window.form.a1 && window.form.a1.primary && key.startsWith('p1')) {
        window.handlePrimaryAuthSigChange(true);
    }
}

window.showPreview = function () {
    isPreview = true;
    renderContent();
};

window.addGoodsItem = function () {
    const input = document.getElementById('hsn-search-input');
    if (!input || !input.value.trim()) return;
    if (!Array.isArray(window.form.goods_hsn)) window.form.goods_hsn = [];
    if (window.form.goods_hsn.length >= 5) {
        alert("You can add up to 5 Commodities.");
        return;
    }
    window.form.goods_hsn.push(input.value.trim());
    input.value = "";
    renderContent();
};

window.removeGoodsItem = function (index) {
    if (Array.isArray(window.form.goods_hsn)) {
        window.form.goods_hsn.splice(index, 1);
        renderContent();
    }
};

window.addServicesItem = function () {
    const input = document.getElementById('sac-search-input');
    if (!input || !input.value.trim()) return;
    if (!Array.isArray(window.form.goods_sac)) window.form.goods_sac = [];
    if (window.form.goods_sac.length >= 5) {
        alert("You can add up to 5 Services.");
        return;
    }
    window.form.goods_sac.push(input.value.trim());
    input.value = "";
    renderContent();
};

window.removeServicesItem = function (index) {
    if (Array.isArray(window.form.goods_sac)) {
        window.form.goods_sac.splice(index, 1);
        renderContent();
    }
};

window.submitApplication = async function () {
    const appId = form._appId || 'APP-' + Math.floor(100000 + Math.random() * 900000);
    form._appId = appId;

    // Auto-add existing registration if left in the form fields without clicking '+ ADD'
    if (form.existingRegistrationType && form.existingRegistrationNo && form.existingRegistrationDate) {
        if (!form.existingRegistrations) form.existingRegistrations = [];
        form.existingRegistrations.push({
            type: form.existingRegistrationType,
            no: form.existingRegistrationNo,
            date: form.existingRegistrationDate
        });
    }

    // Clean up temporary fields so they don't get sent to the database
    const payload = JSON.parse(JSON.stringify(form));
    delete payload.existingRegistrationType;
    delete payload.existingRegistrationNo;
    delete payload.existingRegistrationDate;

    // Reorder promoters based on 'alsoAuthorizedSignatory' timestamp
    let promoters = [];
    for (let i = 1; i <= 10; i++) {
        if (payload[`p${i}`] && Object.keys(payload[`p${i}`]).length > 0) {
            promoters.push(payload[`p${i}`]);
        }
        delete payload[`p${i}`];
    }

    promoters.sort((a, b) => {
        if (a.alsoAuthorizedSignatory && !b.alsoAuthorizedSignatory) return -1;
        if (!a.alsoAuthorizedSignatory && b.alsoAuthorizedSignatory) return 1;
        if (a.alsoAuthorizedSignatory && b.alsoAuthorizedSignatory) {
            const timeA = a.authSigTimestamp || 0;
            const timeB = b.authSigTimestamp || 0;
            return timeA - timeB;
        }
        return 0;
    });

    promoters.forEach((p, idx) => {
        payload[`p${idx + 1}`] = p;
    });

    try {
        const res = await fetch(`${API_BASE_URL}/api/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId, data: payload })
        });
        if (res.ok) {
            alert('Application Submitted Successfully! It is now pending admin review.');
            window.location.reload();
        } else {
            alert('Failed to submit application.');
        }
    } catch (e) {
        console.error(e);
        alert('Backend connection error.');
    }
};

window.generateSummary = function (obj) {
    if (typeof obj !== 'object' || obj === null) {
        return `<div style="margin-top: 4px; padding-left: 10px;">${obj}</div>`;
    }
    
    let printObj = Object.assign({}, obj);
    let isRootForm = ('taxpayerType' in printObj) || ('ppob_building' in printObj);

    let html = '<ul style="list-style-type: none; padding-left: 10px; margin-top: 5px;">';
    
    // Helper function to render a single key
    const renderKey = (key, label) => {
        if (Array.isArray(printObj[key])) {
            if (printObj[key].length === 0) return '';
            let res = `<li><strong>${label}:</strong>`;
            printObj[key].forEach((item, index) => {
                res += `<div style="margin-left: 15px; margin-top: 5px; padding: 10px; border-left: 2px solid #cbd5e1; background: #fff; margin-bottom: 10px; border-radius: 4px;">`;
                res += `<em style="color: #64748b; font-size: 12px;">Entry ${index + 1}</em>`;
                res += window.generateSummary(item);
                res += `</div>`;
            });
            res += `</li>`;
            return res;
        } else if (typeof printObj[key] === 'object' && printObj[key] !== null) {
            let res = `<li style="margin-top: 10px;"><strong>${label}:</strong>`;
            res += `<div style="margin-left: 15px; margin-top: 5px; padding: 10px; border-left: 2px solid #cbd5e1; background: #fff; margin-bottom: 10px; border-radius: 4px;">`;
            res += window.generateSummary(printObj[key]);
            res += `</div></li>`;
            return res;
        } else {
            let val = printObj[key];
            if (typeof val === 'boolean') val = val ? 'Yes' : 'No';
            if (val === '') val = '<span style="color: #94a3b8;">-</span>';
            return `<li style="margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; padding-top: 4px;"><strong>${label}:</strong> ${val}</li>`;
        }
    };

    if (isRootForm) {
        let promoterKeys = Object.keys(printObj).filter(k => k.match(/^p\d+$/)).sort((a,b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
        if (promoterKeys.length > 0) {
            let promotersArray = [];
            for (let k of promoterKeys) {
                promotersArray.push(printObj[k]);
                delete printObj[k];
            }
            printObj.promoters = promotersArray;
        }

        let authSigKeys = Object.keys(printObj).filter(k => k.match(/^a\d+$/)).sort((a,b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
        if (authSigKeys.length > 0) {
            let authSigArray = [];
            for (let k of authSigKeys) {
                authSigArray.push(printObj[k]);
                delete printObj[k];
            }
            printObj.authSig = authSigArray;
        }

        const sections = [
            {
                title: "1. Taxpayer and Business",
                keys: ['taxpayerType', 'legalName', 'tradeName', 'pan', 'email', 'mobile', 'state', 'district', 'businessConstitution', 'dateOfCommencement', 'dateOfLiability', 'reasonToObtainRegistration', 'businessDistrict', 'rule14A', 'existingRegistrationType', 'existingRegistrationNo', 'existingRegistrationDate', 'existingRegistrations', 'proofOfConstitutionType', 'proofOfConstitutionFile', 'documentForTradeNameFile']
            },
            {
                title: "2. Promoters",
                keys: ['promoters']
            },
            {
                title: "3. Authorized Signatory",
                keys: ['authSig']
            },
            {
                title: "4. Place",
                keys: Object.keys(printObj).filter(k => k.startsWith('ppob_'))
            },
            {
                title: "5. Goods & State Specific",
                keys: ['goods_hsn', 'goods_sac'].concat(Object.keys(printObj).filter(k => k.startsWith('stateSpecific_')))
            }
        ];

        for (let sec of sections) {
            html += `<li style="margin-top: 20px;">
                        <h3 style="font-size: 16px; color: #1e3a8a; border-bottom: 2px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">${sec.title}</h3>
                        <ul style="list-style-type: none; padding-left: 0;">`;
            for (let key of sec.keys) {
                if (!(key in printObj)) continue;
                if (key === '_appId') continue;
                let label = PREVIEW_LABELS[key] || key.replace(/^(ppob|res|stateSpecific)_/, '').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                
                html += renderKey(key, label);
                delete printObj[key]; // Mark as processed
            }
            html += `</ul></li>`;
        }
        
        let remainingKeys = Object.keys(printObj).filter(k => k !== '_appId');
        if (remainingKeys.length > 0) {
            html += `<li style="margin-top: 20px;">
                        <h3 style="font-size: 16px; color: #1e3a8a; border-bottom: 2px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">Other Details</h3>
                        <ul style="list-style-type: none; padding-left: 0;">`;
            for (let key of remainingKeys) {
                let label = PREVIEW_LABELS[key] || key.replace(/^(ppob|res|stateSpecific)_/, '').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                html += renderKey(key, label);
            }
            html += `</ul></li>`;
        }
    } else {
        for (let key in printObj) {
            if (key === '_appId') continue;
            let label = PREVIEW_LABELS[key] || key.replace(/^(ppob|res|stateSpecific)_/, '').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            html += renderKey(key, label);
        }
    }
    
    html += '</ul>';
    return html;
};

// --- ADMIN LOGIC ---
let isAdmin = false;
let currentPreviewAppId = null;

window.openAdminLogin = function () {
    document.getElementById('admin-login-modal').classList.remove('hidden');
    document.getElementById('admin-login-error').classList.add('hidden');
};

window.closeAdminLogin = function () {
    document.getElementById('admin-login-modal').classList.add('hidden');
};

window.loginAdmin = function () {
    const user = document.getElementById('admin-username').value;
    const pass = document.getElementById('admin-password').value;
    if (user === 'admin' && pass === 'admin') {
        isAdmin = true;
        closeAdminLogin();
        navigateTo('/admin');
    } else {
        document.getElementById('admin-login-error').classList.remove('hidden');
    }
};

window.exitAdmin = function () {
    if (isAdmin) {
        isAdmin = false;
        navigateTo('/form');
    } else {
        window.location.href = '/form';
    }
};

let allApps = [];

window.renderAdminDashboard = async function () {
    const container = document.getElementById('admin-dashboard-container');

    if (currentPreviewAppId) {
        const app = allApps.find(a => a.appId === currentPreviewAppId);
        if (!app) return;

        let actionButtons = '';
        if (app.status === 'Pending') {
            actionButtons = `<button class="btn accent" style="background: #22c55e; border-color: #22c55e;" onclick="updateAppStatus('${app.appId}', 'Accepted')">Accept</button>
                     <button class="btn" style="background: #ef4444; border-color: #ef4444; color: white;" onclick="updateAppStatus('${app.appId}', 'Rejected')">Reject</button>`;
        } else if (app.status === 'Accepted' || app.status === 'Registered') {
            actionButtons = `<button class="btn accent" style="background: #3b82f6; border-color: #3b82f6;" onclick="registerApplication('${app.appId}')">Register Automatically</button>
                     <button class="btn accent" onclick="editApplication('${app.appId}')">Edit Application</button>`;
        } else if (app.status === 'Rejected') {
            actionButtons = `<button class="btn accent" onclick="editApplication('${app.appId}')">Edit Application</button>`;
        }

        let html = `<div class="card" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0;">Previewing Application: ${app.appId}</h2>
                    <div style="display: flex; gap: 10px;">${actionButtons}</div>
                </div>
                <button class="btn ghost" onclick="currentPreviewAppId = null; renderAdminDashboard();">Back to List</button>
            </div>
            <div style="margin-bottom: 20px;">
                <strong>Status:</strong> <span style="padding: 4px 8px; border-radius: 4px; background: ${app.status === 'Pending' ? '#fef08a' : app.status === 'Accepted' ? '#bbf7d0' : app.status === 'Registered' ? '#6ee7b7' : '#fecaca'};">${app.status}</span>
            </div>
            <div style="background: #f8fafc; padding: 15px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px; overflow-y: visible;">
                ${window.generateSummary(app.data)}
            </div>
        </div>`;
        container.innerHTML = html;
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/applications`);
        allApps = await res.json();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<p>Error loading applications from backend.</p>`;
        return;
    }

    let html = `<div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0;">Admin Dashboard - Applications</h2>
            <button class="btn accent" style="font-size: 14px; padding: 8px 16px; background: #3b82f6; border-color: #3b82f6; color: white;" onclick="navigateTo('/form')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: middle;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg> Home
            </button>
        </div>
        ${allApps.length === 0 ? '<p>No applications submitted yet.</p>' : `
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; text-align: left;">
            <thead>
                <tr style="border-bottom: 2px solid var(--border-color);">
                    <th style="padding: 10px;">App ID</th>
                    <th style="padding: 10px;">Date</th>
                    <th style="padding: 10px;">Legal Name</th>
                    <th style="padding: 10px;">TRN</th>
                    <th style="padding: 10px;">Status</th>
                    <th style="padding: 10px;">Action</th>
                </tr>
            </thead>
            <tbody>
                ${allApps.map(app => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 10px;">${app.appId}</td>
                        <td style="padding: 10px;">${new Date(app.date).toLocaleDateString()}</td>
                        <td style="padding: 10px;">${app.data.legalName || 'N/A'}</td>
                        <td style="padding: 10px; font-weight: 500; color: #0f172a;">${app.trn || '-'}</td>
                        <td style="padding: 10px;"><span style="padding: 2px 6px; border-radius: 4px; font-size: 12px; background: ${app.status === 'Pending' ? '#fef08a' : app.status === 'Accepted' ? '#bbf7d0' : app.status === 'Registered' ? '#6ee7b7' : '#fecaca'};">${app.status}</span></td>
                        <td style="padding: 10px;">
                            <button class="btn" style="padding: 4px 10px; font-size: 13px;" onclick="previewApplication('${app.appId}')">Preview</button>
                            <button class="btn" style="padding: 4px 10px; font-size: 13px; color: white; background: #ef4444; border: none; margin-left: 5px;" onclick="deleteApplication('${app.appId}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `}
    </div>`;
    container.innerHTML = html;
};

window.previewApplication = function (id) {
    currentPreviewAppId = id;
    renderAdminDashboard();
};

window.deleteApplication = async function (id) {
    if (!confirm('Are you sure you want to delete this application permanently?')) return;
    try {
        await fetch(`${API_BASE_URL}/api/applications/${id}`, {
            method: 'DELETE',
        });
        renderAdminDashboard();
    } catch (e) {
        console.error(e);
        alert('Failed to delete application');
    }
};

window.updateAppStatus = async function (id, status) {
    try {
        await fetch(`${API_BASE_URL}/api/applications/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        // Update local state so that if we are previewing, the status updates immediately
        if (typeof allApps !== 'undefined') {
            const appIndex = allApps.findIndex(a => a.appId === id);
            if (appIndex !== -1) {
                allApps[appIndex].status = status;
            }
        }

        renderAdminDashboard();
    } catch (e) {
        console.error(e);
        alert('Failed to update status');
    }
};

let activeAutomationAppId = null;
let socket = null;

function setPipelineActiveStep(stepIndex) {
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('p-step-' + i);
        if (!el) continue;
        if (i < stepIndex) {
            el.className = 'p-step completed';
        } else if (i === stepIndex) {
            el.className = 'p-step active';
        } else {
            el.className = 'p-step';
        }
    }
}

function addTerminalLog(msgStr) {
    const logs = document.getElementById('automation-logs');
    const d = document.createElement('div');
    d.className = 'log-entry';

    let colorClass = 'log-info';
    if (msgStr.includes('Failed') || msgStr.includes('Error')) colorClass = 'log-error';
    if (msgStr.includes('COMPLETED') || msgStr.includes('success')) colorClass = 'log-success';
    if (msgStr.includes('CAPTCHA')) colorClass = 'log-warn';

    d.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span><span class="${colorClass}">${msgStr}</span>`;
    logs.appendChild(d);
    logs.scrollTop = logs.scrollHeight;
}

window.registerApplication = async function (id) {
    const app = allApps.find(a => a.appId === id);
    if (app && app.data) {
        const data = app.data;
        const emails = {};
        const mobiles = {};
        let duplicateError = '';

        const checkDuplicate = (val, type, source) => {
            if (!val) return false;
            val = val.toString().trim().toLowerCase();
            if (type === 'email') {
                if (emails[val]) {
                    duplicateError = `Duplicate Email found: ${val} is used in both ${emails[val]} and ${source}. Please put different emails.`;
                    return true;
                }
                emails[val] = source;
            } else {
                if (mobiles[val]) {
                    duplicateError = `Duplicate Phone Number found: ${val} is used in both ${mobiles[val]} and ${source}. Please put different phone numbers.`;
                    return true;
                }
                mobiles[val] = source;
            }
            return false;
        };

        if (checkDuplicate(data.email, 'email', 'Business Details')) {}
        if (checkDuplicate(data.mobile, 'mobile', 'Business Details')) {}

        if (!duplicateError) {
            for (let i = 1; i <= 10; i++) {
                if (data[`p${i}`] && data[`p${i}`].email) {
                    if (checkDuplicate(data[`p${i}`].email, 'email', `Promoter ${i}`)) break;
                }
                if (data[`p${i}`] && data[`p${i}`].mobile) {
                    if (checkDuplicate(data[`p${i}`].mobile, 'mobile', `Promoter ${i}`)) break;
                }
            }
        }
        
        if (!duplicateError) {
            for (let i = 1; i <= 10; i++) {
                // Skip auth signatory validation if it's the exact same person as a promoter
                // This prevents false positives when a promoter is also the primary authorized signatory
                let isAlsoPromoter = false;
                for (let j = 1; j <= 10; j++) {
                    if (data[`p${j}`] && 
                        data[`p${j}`].email === data[`a${i}`]?.email && 
                        data[`p${j}`].mobile === data[`a${i}`]?.mobile) {
                        isAlsoPromoter = true;
                        break;
                    }
                }
                
                if (!isAlsoPromoter) {
                    if (data[`a${i}`] && data[`a${i}`].email) {
                        if (checkDuplicate(data[`a${i}`].email, 'email', `Authorized Signatory ${i}`)) break;
                    }
                    if (data[`a${i}`] && data[`a${i}`].mobile) {
                        if (checkDuplicate(data[`a${i}`].mobile, 'mobile', `Authorized Signatory ${i}`)) break;
                    }
                }
            }
        }

        if (duplicateError) {
            console.warn(duplicateError + " (Bypassed for testing)");
            // return;
        }

        let missingDocuments = [];
        if (!data.proofOfConstitutionFile) missingDocuments.push('Proof of Constitution');
        if (!data.ppob_docFile) missingDocuments.push('Principal Place of Business Document');

        for (let i = 1; i <= 10; i++) {
            if (data[`p${i}`] && data[`p${i}`].firstName) {
                if (!data[`p${i}`].promoterPhotoFile) missingDocuments.push(`Promoter ${i} Photo`);
            }
        }
        
        for (let i = 1; i <= 10; i++) {
            if (data[`a${i}`] && data[`a${i}`].firstName) {
                let isAlsoPromoter = false;
                for (let j = 1; j <= 10; j++) {
                    if (data[`p${j}`] && data[`p${j}`].alsoAuthorizedSignatory && 
                        data[`p${j}`].email === data[`a${i}`].email) {
                        isAlsoPromoter = true;
                        break;
                    }
                }
                
                if (!isAlsoPromoter) {
                    if (!data[`a${i}`].authSigPhotoFile) missingDocuments.push(`Authorized Signatory ${i} Photo`);
                    if (!data[`a${i}`].authSigProofFile) missingDocuments.push(`Authorized Signatory ${i} Proof of Appointment`);
                }
            }
        }

        if (missingDocuments.length > 0) {
            console.warn(`Important documents are missing: ${missingDocuments.join(', ')}. Bypassing for testing.`);
            // return; // Disabled for testing purposes
        }

        const importantFields = [
            { key: 'legalName', label: 'Legal Name of Business' },
            { key: 'pan', label: 'PAN' },
            { key: 'email', label: 'Primary Email' },
            { key: 'mobile', label: 'Primary Mobile' },
            { key: 'state', label: 'State' },
            { key: 'district', label: 'District' },
            { key: 'businessConstitution', label: 'Constitution of Business' },
            { key: 'ppob_pincode', label: 'Principal Place Pincode' }
        ];

        let missingFields = [];
        importantFields.forEach(f => {
            if (!data[f.key] || data[f.key].toString().trim() === '' || data[f.key].toString().trim() === '-') {
                missingFields.push(f);
            }
        });

        if (missingFields.length > 0) {
            window.currentAppForMissingFields = app;
            const container = document.getElementById('missing-fields-container');
            container.innerHTML = missingFields.map(f => `
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">${f.label}</label>
                    <input type="text" id="missing-field-${f.key}" data-key="${f.key}" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px;" />
                </div>
            `).join('');
            document.getElementById('missing-fields-modal').classList.remove('hidden');
            return;
        }
    }

    window.startAutomationPipeline(id);
};

window.saveMissingFields = async function() {
    const app = window.currentAppForMissingFields;
    if (!app) return;
    const inputs = document.querySelectorAll('#missing-fields-container input');
    
    inputs.forEach(input => {
        const key = input.getAttribute('data-key');
        if (input.value.trim()) {
            app.data[key] = input.value.trim();
        }
    });

    try {
        await fetch(`${API_BASE_URL}/api/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: app.appId, data: app.data })
        });
        
        await fetch(`${API_BASE_URL}/api/applications/${app.appId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: app.status })
        });
    } catch (e) {
        console.error('Failed to save missing fields', e);
    }

    document.getElementById('missing-fields-modal').classList.add('hidden');
    renderAdminDashboard();
    window.startAutomationPipeline(app.appId);
};

window.startAutomationPipeline = async function (id) {
    navigateTo('/automation');

    document.getElementById('automation-logs').innerHTML = '';
    document.getElementById('captcha-card').classList.add('hidden');
    document.getElementById('auto-status-badge').innerText = 'INITIALIZING';

    setPipelineActiveStep(1);
    addTerminalLog('Connecting to secure backend automation pipeline...');

    activeAutomationAppId = id;

    if (!socket) {
        socket = io(`${API_BASE_URL}`);
        socket.on('automation_update', (msg) => {
            const status = msg.status;
            addTerminalLog(status);

            const badge = document.getElementById('auto-status-badge');
            badge.innerText = status.length > 20 ? status.substring(0, 20) + '...' : status;

            if (status.includes('Navigating')) setPipelineActiveStep(2);
            if (status.includes('payload')) setPipelineActiveStep(3);

            if (status === 'WAITING_FOR_CAPTCHA' || status === 'WAITING_FOR_CAPTCHA_TRN') {
                if (status === 'WAITING_FOR_CAPTCHA') setPipelineActiveStep(4);
                badge.innerText = 'ACTION REQUIRED';
                badge.style.color = '#facc15';
                document.getElementById('captcha-card').classList.remove('hidden');
                document.getElementById('captcha-input').focus();
            } else if (status === 'WAITING_FOR_OTP') {
                setPipelineActiveStep(4);
                badge.innerText = 'ACTION REQUIRED';
                badge.style.color = '#facc15';
                document.getElementById('otp-card').classList.remove('hidden');
                document.getElementById('mobile-otp-input').focus();
            } else if (status === 'WAITING_FOR_TRN_OTP') {
                setPipelineActiveStep(4);
                badge.innerText = 'ACTION REQUIRED';
                badge.style.color = '#facc15';
                document.getElementById('trn-otp-card').classList.remove('hidden');
                document.getElementById('trn-otp-input').focus();
            } else if (status === 'COMPLETED') {
                setPipelineActiveStep(5);
                badge.innerText = 'REGISTRATION SUCCESS';
                badge.style.color = '#4ade80';
                badge.classList.remove('pulse-badge');
                updateAppStatus(activeAutomationAppId, 'Registered');
                addTerminalLog('Application submitted successfully.');

                // Fetch the updated TRN and display the big success card (with cache busting)
                fetch(`${API_BASE_URL}/api/applications?t=${Date.now()}`)
                    .then(res => res.json())
                    .then(apps => {
                        const app = apps.find(a => a.appId === activeAutomationAppId);
                        if (app && app.trn) {
                            document.getElementById('trn-display-text').innerText = app.trn;
                        } else {
                            document.getElementById('trn-display-text').innerText = 'Check GST Portal';
                        }
                        // Hide terminal and show success card
                        const term = document.querySelector('.terminal-window');
                        if (term) term.classList.add('hidden');
                        document.getElementById('trn-success-card').classList.remove('hidden');
                    })
                    .catch(err => console.error(err));
            }
        });

        socket.on('automation_captcha_image', (src) => {
            const img = document.getElementById('captcha-img');
            if (img) {
                img.src = src;
                img.style.display = 'inline-block';
            }
        });

        socket.on('automation_warning', () => {
            const badge = document.getElementById('auto-status-badge');
            badge.innerText = 'ADDRESS WARNING';
            badge.style.color = '#f97316';
            document.getElementById('warning-card').classList.remove('hidden');
        });
    }
    socket.emit('join_application', id);

    setTimeout(async () => {
        try {
            await fetch(`${API_BASE_URL}/api/automation/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId: id })
            });
        } catch (e) {
            addTerminalLog('Failed to start automation due to connection error.');
        }
    }, 1000);
};

window.submitCaptcha = async function () {
    const val = document.getElementById('captcha-input').value;
    if (!val) return;

    document.getElementById('captcha-card').classList.add('hidden');
    document.getElementById('captcha-input').value = '';
    const img = document.getElementById('captcha-img');
    if (img) img.style.display = 'none';

    document.getElementById('auto-status-badge').innerText = 'RESUMING PIPELINE';
    document.getElementById('auto-status-badge').style.color = '#60a5fa';

    try {
        await fetch(`${API_BASE_URL}/api/automation/captcha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: activeAutomationAppId, captcha: val })
        });
    } catch (e) {
        console.error(e);
    }
};

window.submitOtp = async function () {
    const mobileOtp = document.getElementById('mobile-otp-input').value;
    const emailOtp = document.getElementById('email-otp-input').value;

    if (!mobileOtp || !emailOtp) return;

    document.getElementById('otp-card').classList.add('hidden');
    document.getElementById('mobile-otp-input').value = '';
    document.getElementById('email-otp-input').value = '';

    document.getElementById('auto-status-badge').innerText = 'RESUMING PIPELINE';
    document.getElementById('auto-status-badge').style.color = '#60a5fa';

    try {
        await fetch(`${API_BASE_URL}/api/automation/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: activeAutomationAppId, mobileOtp, emailOtp })
        });
    } catch (e) {
        console.error(e);
    }
};

window.submitTrnOtp = async function () {
    const otp = document.getElementById('trn-otp-input').value;
    if (!otp) return;

    document.getElementById('trn-otp-card').classList.add('hidden');
    document.getElementById('trn-otp-input').value = '';

    document.getElementById('auto-status-badge').innerText = 'RESUMING PIPELINE';
    document.getElementById('auto-status-badge').style.color = '#60a5fa';

    try {
        // We can reuse the captcha endpoint since it just pipes a single string to stdin
        await fetch(`${API_BASE_URL}/api/automation/captcha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: activeAutomationAppId, captcha: otp })
        });
    } catch (e) {
        console.error(e);
    }
};

window.submitWarningResponse = async function (choice) {
    document.getElementById('warning-card').classList.add('hidden');

    document.getElementById('auto-status-badge').innerText = 'RESUMING PIPELINE';
    document.getElementById('auto-status-badge').style.color = '#60a5fa';

    try {
        await fetch(`${API_BASE_URL}/api/automation/warning_response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: activeAutomationAppId, choice })
        });
    } catch (e) {
        console.error(e);
    }
};

window.deleteFile = async function (filePath, callback) {
    if (filePath && !filePath.startsWith('data:')) {
        try {
            await fetch(`${API_BASE_URL}/api/file`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath })
            });
        } catch (e) { console.error(e); }
    }
    callback();
};

window.closeAutomationModal = async function () {
    if (typeof activeAutomationAppId !== 'undefined' && activeAutomationAppId) {
        try {
            await fetch(`${API_BASE_URL}/api/automation/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId: activeAutomationAppId })
            });
        } catch (e) {
            console.error('Failed to stop automation:', e);
        }
    }

    navigateTo('/admin');

    // reset badge
    const badge = document.getElementById('auto-status-badge');
    badge.style.color = '#60a5fa';
    badge.classList.add('pulse-badge');

    // reset UI for next automation
    const term = document.querySelector('.terminal-window');
    if (term) term.classList.remove('hidden');
    const trnCard = document.getElementById('trn-success-card');
    if (trnCard) trnCard.classList.add('hidden');
};

window.copyTrn = function () {
    const trn = document.getElementById('trn-display-text').innerText;
    if (trn && trn !== '---------' && trn !== 'Check GST Portal') {
        navigator.clipboard.writeText(trn).then(() => {
            alert('TRN copied to clipboard!');
        });
    }
};

window.editApplication = function (id) {
    const app = allApps.find(a => a.appId === id);
    if (app) {
        form = JSON.parse(JSON.stringify(app.data));
        form._appId = app.appId;
        window.exitAdmin();
        setStep(0);
        alert('Application loaded for editing. After you make changes, complete the application to resubmit.');
    }
};

const PREVIEW_LABELS = {
    "goods_hsn": "Goods HSN Code",
    "goods_sac": "Services SAC Code",
    "taxpayerType": "Taxpayer Type",
    "legalName": "Legal Name of Business",
    "tradeName": "Trade Name",
    "pan": "PAN",
    "email": "Email Address",
    "mobile": "Mobile Number",
    "state": "State",
    "district": "District",
    "businessConstitution": "Constitution of Business",
    "dateOfCommencement": "Date of Commencement of Business",
    "dateOfLiability": "Date on which liability to register arises",
    "reasonToObtainRegistration": "Reason to obtain registration",
    "rule14A": "Option for registration under Rule 14A",
    "existingRegistrations": "Existing Registrations",
    "no": "Registration No.",
    "type": "Type of Registration",
    "date": "Date of Registration",
    "businessDistrict": "District (Business)",
    "businessSector": "Sector/Circle/Ward/Charge/Unit",
    "businessCommissionerate": "Commissionerate Code",
    "businessDivision": "Division Code",
    "businessRange": "Range Code",
    "businessJurisdiction": "State Jurisdiction",
    "optComposition": "Opt for Composition?",
    "proofOfConstitutionType": "Proof of Constitution of Business Type",
    "proofOfConstitutionFile": "Proof of Constitution File",
    "documentForTradeNameFile": "Document for Trade Name File",
    "promoters": "Details of Promoters / Partners",
    "firstName": "First Name",
    "middleName": "Middle Name",
    "lastName": "Last Name",
    "fatherFirstName": "Father's First Name",
    "fatherMiddleName": "Father's Middle Name",
    "fatherLastName": "Father's Last Name",
    "dob": "Date of Birth",
    "gender": "Gender",
    "stdCode": "STD Code",
    "telephone": "Telephone Number",
    "designation": "Designation / Status",
    "din": "Director Identification Number (DIN)",
    "citizen": "Are you a citizen of India?",
    "passport": "Passport Number",
    "aadhaar": "Aadhaar Number",
    "res_country": "Residential Country",
    "res_pincode": "Residential PIN Code",
    "res_state": "Residential State",
    "res_district": "Residential District",
    "res_city": "Residential City/Town/Village",
    "res_locality": "Residential Locality/Sub-Locality",
    "res_road": "Residential Road/Street",
    "res_buildingName": "Residential Name of the Premises / Building",
    "res_buildingNo": "Residential Building No. / Flat No.",
    "res_floor": "Residential Floor No.",
    "res_landmark": "Residential Nearby Landmark",
    "authSig": "Details of Authorized Signatory",
    "primary": "Primary Authorized Signatory",
    "ppob_state": "PPOB State",
    "ppob_district": "PPOB District",
    "ppob_pincode": "PPOB PIN Code",
    "ppob_country": "PPOB Country",
    "ppob_landmark": "PPOB Landmark",
    "ppob_latitude": "PPOB Latitude",
    "ppob_longitude": "PPOB Longitude",
    "ppob_stateJurisdiction": "PPOB State Jurisdiction",
    "ppob_commissionerate": "PPOB Commissionerate",
    "ppob_division": "PPOB Division",
    "ppob_range": "PPOB Range",
    "ppob_email": "PPOB Email",
    "ppob_stdCode": "PPOB STD Code",
    "ppob_telephone": "PPOB Telephone",
    "ppob_mobile": "PPOB Mobile",
    "ppob_faxStdCode": "PPOB Fax STD Code",
    "ppob_fax": "PPOB Fax",
    "ppob_natureOfPossession": "PPOB Nature of Possession of Premises",
    "ppob_doc": "PPOB Proof of Principal Place of Business",
    "ppob_docFile": "PPOB Document File",
    "ppob_natureOfBusiness": "PPOB Nature of Business Activity",
    "stateSpecific_profTaxEmpCode": "Professional Tax Employee Code",
    "stateSpecific_profTaxRcNo": "Professional Tax Registration Certificate",
    "stateSpecific_stateExciseLicense": "State Excise License No.",
    "stateSpecific_nameHoldingLicense": "Name of the person holding license",
    "stateSpecific_electricityBoard": "Name of the Electricity Board or Unit",
    "aadhaarAuth": "Opt for Aadhaar Authentication",
    "verificationName": "Name of Authorized Signatory",
    "verificationPlace": "Place",
    "verificationDate": "Date",
    "verificationDesignation": "Designation/Status",
    "promoterPhotoFile": "Promoter Photograph File",
    "authSigProofType": "Proof of Authorized Signatory Type",
    "authSigProofFile": "Proof of Authorized Signatory File",
    "authSigPhotoFile": "Authorized Signatory Photograph File"
};

window.handlePrimaryAuthSigChange = function (checked) {
    window.form[currentAuthSigKey].primary = checked;
    if (checked) {
        for (const key in window.form) {
            if (key.match(/^a\d+$/) && key !== currentAuthSigKey) {
                window.form[key].primary = false;
            }
        }
        if (currentAuthSigKey === 'a1') {
            const p1 = window.form.p1;
            const a1 = window.form.a1;
            for (const k in window.defaultPromoter) {
                if (k !== 'promoterPhotoFile' && k in window.defaultAuthSig) {
                    a1[k] = p1[k];
                }
            }
        }
    }
    renderContent();
};


window.updatePersonName = function (section, field, value) {
    const obj = (section === 'promoter') ? window.form[currentPromoterKey] : window.form[currentAuthSigKey];
    obj[field] = value;
    renderContent();
};

window.addPromoter = function() {
    let max = 0;
    for(let k in window.form) {
        if(k.match(/^p\d+$/)) {
            let num = parseInt(k.substring(1));
            if(num > max) max = num;
        }
    }
    if(max >= 10) {
        alert("Maximum 10 partners allowed.");
        return;
    }
    currentPromoterKey = 'p' + (max + 1);
    window.form[currentPromoterKey] = JSON.parse(JSON.stringify(window.defaultPromoter));
    isPromoterListView = false;
    renderContent();
};

window.editPromoter = function(key) {
    currentPromoterKey = key;
    isPromoterListView = false;
    renderContent();
};

window.deletePromoter = function(key) {
    if(key === 'p1') {
        alert("Cannot delete the primary partner (p1).");
        return;
    }
    if(confirm("Are you sure you want to delete this partner?")) {
        delete window.form[key];
        // if we just deleted the current one, switch back to list
        if(currentPromoterKey === key) {
             currentPromoterKey = 'p1';
             isPromoterListView = true;
        }
        renderContent();
    }
};


window.addAuthSig = function() {
    let max = 0;
    for(let k in window.form) {
        if(k.match(/^a\d+$/)) {
            let num = parseInt(k.substring(1));
            if(num > max) max = num;
        }
    }
    if(max >= 10) {
        alert("Maximum 10 authorized signatories allowed.");
        return;
    }
    currentAuthSigKey = 'a' + (max + 1);
    window.form[currentAuthSigKey] = JSON.parse(JSON.stringify(window.defaultAuthSig));
    isAuthSigListView = false;
    window.isViewingPromoter = false;
    renderContent();
};

window.editAuthSig = function(key) {
    currentAuthSigKey = key;
    isAuthSigListView = false;
    window.isViewingPromoter = false;
    renderContent();
};

window.deleteAuthSig = function(key) {
    if(window.form[key] && window.form[key].primary) {
        alert("Cannot delete the primary authorized signatory.");
        return;
    }
    if(confirm("Are you sure you want to delete this authorized signatory?")) {
        delete window.form[key];
        if(currentAuthSigKey === key) {
             const remainingKeys = Object.keys(window.form).filter(k => k.match(/^a\d+$/)).sort();
             currentAuthSigKey = remainingKeys.length > 0 ? remainingKeys[0] : null;
             isAuthSigListView = true;
        }
        renderContent();
    }
};

window.viewPromoterAsAuthSig = function(key) {
    currentAuthSigKey = key;
    isAuthSigListView = false;
    window.isViewingPromoter = true;
    renderContent();
};

window.removePromoterFromAuthSig = function(key) {
    if(confirm("Are you sure you want to remove this promoter from authorized signatories?")) {
        window.form[key].alsoAuthorizedSignatory = false;
        renderContent();
    }
};

window.handlePrimaryAuthSigChange = function(isChecked) {
    if (isChecked) {
        for (let key in window.form) {
            if (key.match(/^a\d+$/) || key.match(/^p\d+$/)) {
                if (window.form[key]) {
                    window.form[key].primary = false;
                }
            }
        }
        if (window.form[currentAuthSigKey]) {
            window.form[currentAuthSigKey].primary = true;
        }
        renderContent();
    }
};

window.showAuthSigList = function() {
    isAuthSigListView = true;
    window.isViewingPromoter = false;
    renderContent();
};

window.showPromoterList = function() {
    isPromoterListView = true;
    renderContent();
};

function renderContent() {
    const content = document.getElementById('wizard-content-inner');
    if (!content) return;

    if (isPreview) {
        let summaryHtml = `<section class="card"><h2>Application Preview</h2><div class="summary-content" style="text-align: left; overflow-y: visible; font-size: 14px; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">`;

        summaryHtml += window.generateSummary(form);
        summaryHtml += `</div>
        <div style="display: flex; gap: 10px;">
            <button class="btn accent" onclick="submitApplication()">Submit Application</button>
            <button class="btn ghost" onclick="isPreview = false; setStep(0);">Edit Application</button>
        </div>
        </section>`;

        content.innerHTML = summaryHtml;
        return;
    }

    let html = '';
    if (step === 0) {
        html = `<section class="card">
        <!-- Two-column horizontal layout: Taxpayer left, Business right -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">

            <!-- LEFT: Taxpayer Information -->
            <div style="border-right: 1px solid var(--border-color); padding-right: 20px;">
                <h2 style="font-size: 16px; color: #1e3a8a; margin: 0 0 12px 0; font-weight: 700; border-left: 3px solid #1e3a8a; padding-left: 10px;">Taxpayer information</h2>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                    ${field('TAXPAYER TYPE', select('taxpayerType', form.taxpayerType, ['Regular Taxpayer', 'Composition Taxpayer', 'Casual Taxable Person'], 'Select'))}
                    ${field('LEGAL NAME (AS PER PAN)', textInput('legalName', form.legalName))}
                    ${field('PAN <span style="color: #ef4444">*</span>', `
                        ${textInput('pan', form.pan, 'oninput="updatePanFormatBoxes(this.value)" placeholder="Enter PAN" maxlength="10" pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}" style="text-transform:uppercase"')}
                        <div style="font-size: 11px; color: #000; margin-top: 4px; font-weight: 500; position: absolute; top: 100%; left: 0;">
                            Eg: 
                            <span id="pan_box_0" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">A</span><span id="pan_box_1" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">B</span><span id="pan_box_2" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">C</span><span id="pan_box_3" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">D</span><span id="pan_box_4" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">E</span><span id="pan_box_5" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">1</span><span id="pan_box_6" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">2</span><span id="pan_box_7" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">3</span><span id="pan_box_8" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; margin-right: 1px; font-size: 10px;">4</span><span id="pan_box_9" style="display: inline-block; background-color: #fce8e6; color: #b91c1c; width: 16px; height: 16px; text-align: center; line-height: 16px; font-size: 10px;">X</span>
                        </div>
                    `)}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
                    ${field('EMAIL', `<input type="email" value="${form.email}" onchange="updateForm('email', this.value)" />`)}
                    ${field('MOBILE', textInput('mobile', form.mobile, 'placeholder="Enter Mobile" maxlength="10" pattern="[0-9]{10}"'))}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
                    ${field('STATE / UT', select('state', form.state, window.fetchedStates || [], 'Select state'))}
                    ${field('DISTRICT', select('district', form.district, getDistricts(form.state), 'Select district'))}
                </div>
            </div>

            <!-- RIGHT: Business Details -->
            <div>
                <h2 style="font-size: 16px; color: #1e3a8a; margin: 0 0 12px 0; font-weight: 700; border-left: 3px solid #1e3a8a; padding-left: 10px;">Business details</h2>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                    ${field('TRADE NAME', textInput('tradeName', form.tradeName))}
                    ${field('CONSTITUTION', select('businessConstitution', form.businessConstitution, BUSINESS_TYPES, 'Select constitution'))}
                    ${field('DISTRICT', select('businessDistrict', form.businessDistrict, getDistricts(form.state), 'Select district'))}
                </div>

                ${(() => {
                const c = form.businessConstitution;
                const showWarning = ['Partnership', 'Private Limited Company', 'Public Limited Company', 'Society/ Club/ Trust/ AOP', 'Unlimited Company', 'Foreign Company', 'Foreign Limited Liability Partnership', 'Government Department', 'Hindu Undivided Family', 'Limited Liability Partnership', 'Local Authority'].includes(c);
                const showInfoTooltip = ['Private Limited Company', 'Public Limited Company', 'Public Sector Undertaking', 'Unlimited Company', 'Foreign Company', 'Foreign Limited Liability Partnership', 'Limited Liability Partnership'].includes(c);
                const hideRule14A = ['Public Sector Undertaking', 'Statutory Body', 'Government Department', 'Local Authority'].includes(c);
                let html = '';
                if (showWarning) {
                    html += '<div style="margin-top: 12px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; color: #b91c1c; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Warning! PAN provided in Part A is not matching with the Constitution of Business selected.</div>';
                }
                if (showInfoTooltip) {
                    html += '<div style="margin-top: 10px; padding: 10px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; color: #1e40af; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; cursor: default; position: relative;" title="Adding Corporate Identity / Foreign Company Registration Number Is Mandatory"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e40af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> Adding \'Corporate Identity / Foreign Company Registration Number\' Is Mandatory</div>';
                }
                return html;
            })()}

                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 12px;">
                    ${field('DATE OF COMMENCEMENT', `<input type="date" value="${form.dateOfCommencement}" onchange="updateForm('dateOfCommencement', this.value)" />`)}
                    ${field('DATE ON WHICH LIABILITY TO REGISTER ARISES <span style="color: #ef4444">*</span>', `<input type="date" value="${form.dateOfLiability}" onchange="updateForm('dateOfLiability', this.value)" />`)}
                    ${field('REASON TO OBTAIN REGISTRATION', select('reasonToObtainRegistration', form.reasonToObtainRegistration, REGISTRATION_REASONS, 'Select'))}
                </div>
                ${!['Public Sector Undertaking', 'Statutory Body', 'Government Department', 'Local Authority'].includes(form.businessConstitution) ? `
                <div style="margin-top: 12px;">
                    <div class="field" style="background: #f8fafc; padding: 10px 14px; border-radius: 4px; border: 1px solid #e2e8f0; border-left: 3px solid #cbd5e1;">
                        <label style="display: block; margin-bottom: 10px; color: #334155; font-size: 13px; font-weight: 600; text-transform: uppercase;">Option for registration under Rule 14A <span style="color: #ef4444">*</span></label>
                        <div style="display: flex; gap: 16px;">
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #334155; cursor: pointer;">
                                <input type="radio" name="rule14A" value="Yes" ${form.rule14A === 'Yes' ? 'checked' : ''} onchange="updateForm('rule14A', this.value)" style="accent-color: #22c55e;" /> YES
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #334155; cursor: pointer;">
                                <input type="radio" name="rule14A" value="No" ${form.rule14A === 'No' ? 'checked' : ''} onchange="updateForm('rule14A', this.value)" style="accent-color: #22c55e;" /> NO
                            </label>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>

        <!-- Full-width: Existing Registrations & Document Upload -->
        <div style="margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 12px;">
            <h3 style="font-size: 14px; font-weight: 600; color: #1e3a8a; margin: 0 0 12px 0; font-style: italic;">Indicate Existing Registrations & Document Upload</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 16px; align-items: end;">
                ${field('TYPE OF REGISTRATION', select('existingRegistrationType', form.existingRegistrationType, EXISTING_REGISTRATION_TYPES, 'Select'))}
                ${field('REGISTRATION NO. <span style="color: #ef4444">*</span>', textInput('existingRegistrationNo', form.existingRegistrationNo))}
                ${field('DATE OF REGISTRATION <span style="color: #ef4444">*</span>', `<input type="date" id="existingRegistrationDate" value="${form.existingRegistrationDate}" onchange="updateForm('existingRegistrationDate', this.value)" />`)}
                <div style="display: flex; gap: 8px; padding-bottom: 4px;">
                    <button style="padding: 10px 16px; background-color: #2e5387; color: white; border: none; font-size: 13px; border-radius: 2px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="window.addExistingRegistration(); return false;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> ADD
                    </button>
                    <button style="padding: 10px 16px; background-color: white; color: #333; border: 1px solid #cbd5e1; font-size: 13px; border-radius: 2px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="window.cancelExistingRegistration(); return false;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> CANCEL
                    </button>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px;">
                ${form.businessConstitution && !['Hindu Undivided Family', 'Proprietorship'].includes(form.businessConstitution) ? field('PROOF OF CONSTITUTION OF BUSINESS <span style="color: #ef4444">*</span>', `
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${select('proofOfConstitutionType', form.proofOfConstitutionType, ['Certificate of Incorporation', 'Registration Certificate', 'Partnership Deed', 'Other'], 'Select')}
                        <input type="file" accept=".pdf, .jpeg, .jpg" onchange="window.handleFileUpload(this, 'pdf/jpeg', 1024, (data, filename) => { window.form.proofOfConstitutionFile = data; window.form.proofOfConstitutionFileName = filename; renderContent(); })" style="font-size: 12px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; ${form.proofOfConstitutionFile ? 'display: none;' : ''}" />
                        <div style="font-size: 10px; color: #64748b; margin-top: 4px;">
                            ℹ PDF/JPEG only. Max 1 MB.
                            ${form.proofOfConstitutionFile ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 500; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;"><span style="word-break: break-all;">📄 ${form.proofOfConstitutionFileName || 'Uploaded Document'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form.proofOfConstitutionFile, () => { window.form.proofOfConstitutionFile = ''; window.form.proofOfConstitutionFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form.proofOfConstitutionFile); return false;" class="btn-doc-view">View</button></div></div>` : ''}
                        </div>
                    </div>
                `) : ''}
            </div>
        </div>

        ${form.existingRegistrations && form.existingRegistrations.length > 0 ? `
            <div style="margin-top: 24px;">
                <div style="font-size: 13px; font-style: italic; color: #333; margin-bottom: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>Adding 'Corporate Identity / Foreign Company Registration Number' Is Mandatory
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; border: 1px solid #e2e8f0;">
                    <thead>
                        <tr style="border-bottom: 1px solid #cbd5e1; background-color: #f8fafc; text-align: left;">
                            <th style="padding: 12px; font-weight: 600; color: #334155;">Type of Registration</th>
                            <th style="padding: 12px; font-weight: 600; color: #334155;">Registration No.</th>
                            <th style="padding: 12px; font-weight: 600; color: #334155;">Date of Registration</th>
                            <th style="padding: 12px; font-weight: 600; color: #334155;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${form.existingRegistrations.map((r, i) => `
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 12px;">${r.type}</td>
                            <td style="padding: 12px;">${r.no}</td>
                            <td style="padding: 12px;">${r.date.split('-').reverse().join('/')}</td>
                            <td style="padding: 12px;">
                                <div style="display: flex; gap: 8px;">
                                    <button onclick="window.editExistingRegistration(${i}); return false;" style="padding: 6px 12px; background-color: #3b5998; color: white; border: none; border-radius: 2px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> EDIT</button>
                                    <button onclick="window.deleteExistingRegistration(${i}); return false;" style="padding: 6px 12px; background-color: #ef4444; color: white; border: none; border-radius: 2px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> DELETE</button>
                                </div>
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : ''}
        </section>`;
    } else if (step === 1) {
        if (isPromoterListView) {
            let promoterKeys = Object.keys(window.form).filter(k => k.match(/^p\d+$/)).sort((a,b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
            let rows = promoterKeys.map((k, i) => {
                const p = window.form[k];
                const name = (p.firstName || p.lastName) ? `${p.firstName || ''} ${p.middleName || ''} ${p.lastName || ''}`.replace(/\s+/g, ' ').trim() : '[No Name Yet]';
                const desig = p.designation || '[No Designation]';
                return `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; text-align: center;">${i + 1}</td>
                    <td style="padding: 12px; font-weight: 500; color: #1e293b;">${name}</td>
                    <td style="padding: 12px; color: #475569;">${desig}</td>
                    <td style="padding: 12px; text-align: right;">
                        <button class="btn" style="padding: 6px 12px; font-size: 13px; margin-right: 8px;" onclick="window.editPromoter('${k}')">EDIT</button>
                        ${k !== 'p1' ? `<button class="btn" style="padding: 6px 12px; font-size: 13px; background-color: #ef4444; color: white; border: none;" onclick="window.deletePromoter('${k}')">DELETE</button>` : ''}
                    </td>
                </tr>`;
            }).join('');
            
            html = `<section class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="font-size: 18px; margin: 0; color: #1e3a8a;">Details of Promoters / Partners</h2>
                </div>
                <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: var(--radius-md); overflow: hidden;">
                    <thead style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                        <tr>
                            <th style="padding: 12px; text-align: center; width: 60px; font-weight: 600; color: #334155;">Sl No</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; color: #334155;">Name</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; color: #334155;">Designation / Status</th>
                            <th style="padding: 12px; text-align: right; font-weight: 600; color: #334155;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div style="margin-top: 20px; text-align: left;">
                    <button class="btn accent" style="padding: 10px 20px; font-weight: 600;" onclick="window.addPromoter()">+ Add promoter</button>
                </div>
            </section>`;
        } else {
            const pForm = window.form[currentPromoterKey];
            html = `<section class="card">
            <!-- Form View Header with Show List Button -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
                <h2 style="font-size: 18px; margin: 0; color: #1e3a8a;">Details of Promoter / Partner (${currentPromoterKey.toUpperCase()})</h2>
                <button class="btn ghost" style="padding: 8px 16px; border: 1px solid #cbd5e1;" onclick="window.showPromoterList()">Show list</button>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 32px; align-items: start;">
            <div>
            <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Personal Information</h2>
            
            <div style="margin-bottom: 12px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 600; font-size: 14px; color: var(--text-main);">Name of Person</label>
                <div class="grid3">
                    ${field('First Name <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter First Name" value="${pForm.firstName || ''}" onchange="window.updateForm('${currentPromoterKey}.firstName', this.value)" />`)}
                    ${field('Middle Name', `<input type="text" placeholder="Enter Middle Name" value="${pForm.middleName || ''}" onchange="window.updatePersonName('promoter', 'middleName', this.value)" />`)}
                    ${field('Last Name', `<input type="text" placeholder="Enter Last Name" value="${pForm.lastName || ''}" onchange="window.updatePersonName('promoter', 'lastName', this.value)" />`)}
                </div>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 600; font-size: 14px; color: var(--text-main);">Name of Father</label>
                <div class="grid3">
                    ${field('First Name <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter First Name" value="${pForm.fatherFirstName || ''}" onchange="window.updateForm('${currentPromoterKey}.fatherFirstName', this.value)" />`)}
                    ${field('Middle Name', `<input type="text" placeholder="Enter Middle Name" value="${pForm.fatherMiddleName || ''}" onchange="window.updateForm('${currentPromoterKey}.fatherMiddleName', this.value)" />`)}
                    ${field('Last Name', `<input type="text" placeholder="Enter Last Name" value="${pForm.fatherLastName || ''}" onchange="window.updateForm('${currentPromoterKey}.fatherLastName', this.value)" />`)}
                </div>
            </div>

            <div class="grid3" style="margin-bottom: 12px;">
                ${field('Date of Birth <span style="color: #ef4444">*</span>', `<input type="date" value="${pForm.dob || ''}" onchange="window.updateForm('${currentPromoterKey}.dob', this.value)" />`)}
                ${field('Mobile Number <span style="color: #ef4444">*</span>', `<div style="display: flex;"><span style="display: inline-flex; align-items: center; padding: 0 12px; background: #f8fafc; border: 1px solid var(--border-color); border-right: none; border-radius: var(--radius-md) 0 0 var(--radius-md); color: var(--text-muted); font-size: 15px; font-weight: 500;">+91</span><input type="text" placeholder="Enter Mobile Number" pattern="[0-9]{10}" style="border-radius: 0 var(--radius-md) var(--radius-md) 0; flex: 1;" value="${pForm.mobile || ''}" onchange="window.updateForm('${currentPromoterKey}.mobile', this.value)" /></div>`)}
                ${field('Email Address <span style="color: #ef4444">*</span>', `<input type="email" placeholder="Enter Email Address" value="${pForm.email || ''}" onchange="window.updateForm('${currentPromoterKey}.email', this.value)" />`)}
            </div>

            <div class="grid" style="grid-template-columns: 1fr 2fr; gap: 16px;">
                <div class="field">
                    <label>Gender <span style="color: #ef4444">*</span></label>
                    <div style="display: flex; gap: 20px; margin-top: 10px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 15px; color: var(--text-main); cursor: pointer;"><input type="radio" name="gender" value="Male" ${pForm.gender === 'Male' ? 'checked' : ''} onchange="window.updateForm('${currentPromoterKey}.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> Male</label>
                        <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 15px; color: var(--text-main); cursor: pointer;"><input type="radio" name="gender" value="Female" ${pForm.gender === 'Female' ? 'checked' : ''} onchange="window.updateForm('${currentPromoterKey}.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> Female</label>
                        <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 15px; color: var(--text-main); cursor: pointer;"><input type="radio" name="gender" value="Others" ${pForm.gender === 'Others' ? 'checked' : ''} onchange="window.updateForm('${currentPromoterKey}.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> Others</label>
                    </div>
                </div>

            </div>

            <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-top: 32px; margin-bottom: 12px;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg> Identity Information</h2>
            
            <div class="grid3" style="margin-bottom: 12px; align-items: center;">
                ${field('Designation / Status <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Designation" value="${pForm.designation || ''}" onchange="window.updateForm('${currentPromoterKey}.designation', this.value)" />`)}
                ${field('Director Identification Number <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter DIN Number" value="${pForm.din || ''}" onchange="window.updateForm('${currentPromoterKey}.din', this.value)" />`)}
            </div>

            <div class="grid3" style="margin-bottom: 12px;">
                ${field('PAN <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter PAN" value="${pForm.pan || ''}" onchange="window.updateForm('${currentPromoterKey}.pan', this.value)" style="text-transform:uppercase" maxlength="10" pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}" />`)}
                ${field('Passport Number (In case of Foreigner)', `<input type="text" placeholder="Enter Passport Number" value="${pForm.passport || ''}" onchange="window.updateForm('${currentPromoterKey}.passport', this.value)" />`)}
            </div>
            </div>
            <div>
            <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg> Residential Address</h2>
            
            <div style="margin-bottom: 12px; font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 500;">Address Validation Info</span>
                <span style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #333; color: #fff; border-radius: 50%; font-size: 12px; font-weight: bold; cursor: help;" onmouseover="this.querySelector('.address-tooltip-text').style.display='block'" onmouseout="this.querySelector('.address-tooltip-text').style.display='none'">
                    ?
                    <div class="address-tooltip-text" style="display: none; position: absolute; left: 25px; top: -10px; width: 350px; background-color: var(--primary); border: 1px solid var(--primary); padding: 12px; border-radius: var(--radius-md); font-size: 12px; color: #ffffff; font-style: normal; line-height: 1.4; z-index: 100; box-shadow: var(--shadow-lg); font-weight: normal; text-align: left;">
                        i. Please be aware that the GST system incorporates mandatory address validations for accuracy and uniformity. These include front-end validations upon entry and back-end cross-checks with GST system geocoding engine.<br><br>
                        ii. Users must ensure that addresses entered align with these validations and any corresponding address proof. Your adherence helps maintain system integrity. Thank you for your cooperation.
                    </div>
                </span>
            </div>


            <div class="grid3" style="margin-bottom: 12px;">
                ${field('Country <span style="color: #ef4444">*</span>', `<select onchange="window.updateForm('${currentPromoterKey}.res_country', this.value)" style="background-color: #f1f5f9; cursor: not-allowed;" readonly><option value="India" selected>India</option></select>`)}
                ${field('PIN Code <span style="color: #ef4444">*</span>', `<div style="position:relative"><input type="text" placeholder="Enter PIN Code" value="${pForm.res_pincode || ''}" oninput="searchPincode(this.value, '${currentPromoterKey}.res_pincode')" onfocus="searchPincode(this.value, '${currentPromoterKey}.res_pincode')" onblur="setTimeout(() => { const el = document.getElementById('pincode_suggestions'); if(el) el.style.display='none'; }, 200)" maxlength="6" pattern="[0-9]{6}" autocomplete="off" /><ul id="pincode_suggestions" style="position:absolute; display:none; background:#fff; border:1px solid var(--border-color); width:100%; max-height:200px; overflow-y:auto; list-style:none; margin:0; padding:0; z-index:10; border-radius:var(--radius-sm); box-shadow:var(--shadow-md);"></ul></div>`)}
                ${field('State <span style="color: #ef4444">*</span>', `<select onchange="window.form['${currentPromoterKey}'].res_state=this.value; window.form['${currentPromoterKey}'].res_district=''; if(window.fetchAndSetDistricts) window.fetchAndSetDistricts(this.value, renderContent); else renderContent()"><option value="">Enter State Name</option>${(window.fetchedStates || []).map(s => `<option value="${s}" ${pForm.res_state === s ? 'selected' : ''}>${s}</option>`).join('')}${pForm.res_state && !(window.fetchedStates || []).includes(pForm.res_state) ? `<option value="${pForm.res_state}" selected>${pForm.res_state}</option>` : ''}</select>`)}
            </div>

            <div class="grid3" style="margin-bottom: 12px;">
                ${field('District <span style="color: #ef4444">*</span>', `<select onchange="window.updateForm('${currentPromoterKey}.res_district', this.value)"><option value="">Enter District Name</option>${getDistricts(pForm.res_state || '').map(d => `<option value="${d}" ${pForm.res_district === d ? 'selected' : ''}>${d}</option>`).join('')}${pForm.res_district && !getDistricts(pForm.res_state || '').includes(pForm.res_district) ? `<option value="${pForm.res_district}" selected>${pForm.res_district}</option>` : ''}</select>`)}
                ${field('City / Town / Village <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter City / Town / Village" value="${pForm.res_city || ''}" onchange="window.updateForm('${currentPromoterKey}.res_city', this.value)" />`)}
                ${field('Locality/Sub Locality', `<input type="text" placeholder="Enter Locality / Sublocality" value="${pForm.res_locality || ''}" onchange="window.updateForm('${currentPromoterKey}.res_locality', this.value)" />`)}
            </div>

            <div class="grid3" style="margin-bottom: 12px;">
                ${field('Road / Street <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Road / Street / Lane" value="${pForm.res_road || ''}" onchange="window.updateForm('${currentPromoterKey}.res_road', this.value)" />`)}
                ${field('Name of the Premises / Building', `<input type="text" placeholder="Enter Name of Premises / Building" value="${pForm.res_buildingName || ''}" onchange="window.updateForm('${currentPromoterKey}.res_buildingName', this.value)" />`)}
                ${field('Building No. / Flat No. <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Building No. / Flat No. / Door No." value="${pForm.res_buildingNo || ''}" onchange="window.updateForm('${currentPromoterKey}.res_buildingNo', this.value)" />`)}
            </div>

            <div class="grid3" style="margin-bottom: 12px;">
                ${field('Floor No.', `<input type="text" placeholder="Enter Floor No." value="${pForm.res_floor || ''}" onchange="window.updateForm('${currentPromoterKey}.res_floor', this.value)" />`)}
                ${field('Nearby Landmark', `<input type="text" placeholder="Enter Nearby Landmark" value="${pForm.res_landmark || ''}" onchange="window.updateForm('${currentPromoterKey}.res_landmark', this.value)" />`)}
            </div>
            <h3 style="font-size: 18px; font-weight: 600; color: #1e3a8a; margin: 32px 0 20px;">
                Other Information
            </h3>
            <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px; background: #f8fafc;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <div style="font-size: 15px; font-weight: 600; color: #1e293b;">Also Authorized Signatory</div>
                        <p style="font-size: 13px; color: #64748b; margin-top: 4px;">Is this promoter also an authorized signatory?</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 14px; font-weight: 600; color: ${pForm.alsoAuthorizedSignatory ? '#22c55e' : '#94a3b8'};">${pForm.alsoAuthorizedSignatory ? 'Yes' : 'No'}</span>
                        <label class="switch">
                            <input type="checkbox" ${pForm.alsoAuthorizedSignatory ? 'checked' : ''} onchange="window.updateForm('${currentPromoterKey}.alsoAuthorizedSignatory', this.checked); renderContent();">
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>
                ${pForm.alsoAuthorizedSignatory ? `
                <hr style="border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                <div style="margin-bottom: 12px;">
                    ${field('Proof of details of authorized signatory <span style="color: #ef4444">*</span>', `<select style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 14px; margin-bottom: 8px; outline: none;" onchange="window.form['${currentPromoterKey}'].authSigProofType = this.value; renderContent();"><option value="">Select</option><option value="Letter of Authorisation" ${pForm.authSigProofType === 'Letter of Authorisation' ? 'selected' : ''}>Letter of Authorisation</option><option value="Copy of resolution passed by BoD / Managing Committee" ${pForm.authSigProofType === 'Copy of resolution passed by BoD / Managing Committee' ? 'selected' : ''}>Copy of resolution passed by BoD / Managing Committee</option></select>`)}
                    <p style="font-size: 12px; color: #64748b; margin-top: 4px;">ℹ File with PDF or JPEG format is only allowed. Max size 1 MB.</p>
                    <input type="file" accept=".pdf, .jpeg, .jpg" onchange="window.handleFileUpload(this, 'pdf/jpeg', 1024, (data, filename) => { window.form['${currentPromoterKey}'].authSigProofFile = data; window.form['${currentPromoterKey}'].authSigProofFileName = filename; renderContent(); })" style="font-size: 14px; margin-top: 4px; ${pForm.authSigProofFile ? 'display: none;' : ''}" />
                    ${pForm.authSigProofFile ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 500; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;"><span style="word-break: break-all;">📄 ${pForm.authSigProofFileName || 'Uploaded Document'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form['${currentPromoterKey}'].authSigProofFile, () => { window.form['${currentPromoterKey}'].authSigProofFile = ''; window.form['${currentPromoterKey}'].authSigProofFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form['${currentPromoterKey}'].authSigProofFile); return false;" class="btn-doc-view">View</button></div></div>` : ''}
                </div>
                ` : ''}
            </div>
            <h3 style="font-size: 18px; font-weight: 600; color: #1e3a8a; margin: 32px 0 20px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: text-bottom; margin-right: 8px;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
                Document Upload
            </h3>
            <div style="border: 1px solid #e2e8f0; padding: 20px; border-radius: var(--radius-md);">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px;">
                    <div style="flex: 1; min-width: 300px;">
                        <div style="font-size: 14px; font-weight: 500; color: #1e293b; margin-bottom: 8px;">Upload Photograph (of person whose information has been given above) <span style="color: #ef4444">*</span></div>
                        <p style="font-size: 12px; color: #64748b; margin-top: 8px;">ℹ Only JPEG file format is allowed</p>
                        <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">ℹ Maximum file size for upload is 100 KB</p>
                        <input type="file" accept="image/jpeg, image/jpg" onchange="window.handleFileUpload(this, 'jpeg', 100, (data, filename) => { window.form['${currentPromoterKey}'].promoterPhotoFile = data; window.form['${currentPromoterKey}'].promoterPhotoFileName = filename; renderContent(); })" style="font-size: 14px; margin-top: 5px; ${pForm.promoterPhotoFile ? 'display: none;' : ''}" />
                        ${pForm.promoterPhotoFile ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 500; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;"><span style="word-break: break-all;">📄 ${pForm.promoterPhotoFileName || 'Uploaded Photograph'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form['${currentPromoterKey}'].promoterPhotoFile, () => { window.form['${currentPromoterKey}'].promoterPhotoFile = ''; window.form['${currentPromoterKey}'].promoterPhotoFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form['${currentPromoterKey}'].promoterPhotoFile); return false;" class="btn-doc-view">View</button></div></div>` : ''}
                    </div>
                </div>
            </div>
            <div style="margin-top: 20px; text-align: left; padding-top: 20px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <button class="btn accent" style="padding: 10px 20px; font-weight: 600;" onclick="window.showPromoterList()">Save Promoter & Show list</button>
                </div>
            </div>
            </div>
            </div>
            </section>`;
        }

    } else if (step === 2) {

        if (isAuthSigListView) {
            let pureAuthSigKeys = Object.keys(window.form).filter(k => k.match(/^a\d+$/)).sort((a,b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
            let promoterAuthSigKeys = Object.keys(window.form).filter(k => k.match(/^p\d+$/) && window.form[k].alsoAuthorizedSignatory).sort((a,b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
            let authSigKeys = [...promoterAuthSigKeys, ...pureAuthSigKeys];
            let rows = authSigKeys.map((k, i) => {
                const a = window.form[k];
                const name = (a.firstName || a.lastName) ? `${a.firstName || ''} ${a.middleName || ''} ${a.lastName || ''}`.replace(/\s+/g, ' ').trim() : '[No Name Yet]';
                const desig = a.designation || '[No Designation]';
                
                const outlineUser = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#15803d" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
                const primaryUser = `<svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle; margin-right:2px;"><circle cx="12" cy="12" r="11" fill="#15803d"/><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 7s1-4 6-4 6 4 6 4H6z" fill="#fff"/></svg>`;
                const primaryStar = `<svg viewBox="0 0 24 24" width="14" height="14" fill="#15803d" style="vertical-align: middle; margin-right:4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
                
                let nameIcons = '';
                if (k.match(/^p\d+$/)) {
                    nameIcons = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#000" stroke-width="2" fill="none" style="vertical-align: middle; margin-right:4px;"><circle cx="12" cy="12" r="11"/><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 7s1-4 6-4 6 4 6 4H6z"/></svg>` + (a.primary ? primaryUser + primaryStar : '');
                } else {
                    nameIcons = outlineUser + (a.primary ? primaryUser + primaryStar : '');
                }

                let actionsHTML = '';
                if (k.match(/^p\d+$/)) {
                    actionsHTML = `
                        <button class="btn" style="padding: 6px 12px; font-size: 13px; margin-right: 8px; border-radius: 4px; background-color: #3b82f6; color: white; border: none;" onclick="window.viewPromoterAsAuthSig('${k}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> VIEW</button>
                        ${(authSigKeys.length > 1 && !a.primary) ? `<button class="btn" style="padding: 6px 12px; font-size: 13px; background-color: #ef4444; color: white; border: none; border-radius: 4px;" onclick="window.removePromoterFromAuthSig('${k}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" style="vertical-align:middle;margin-right:4px;"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg> DELETE</button>` : ''}
                    `;
                } else {
                    actionsHTML = `
                        <button class="btn" style="padding: 6px 12px; font-size: 13px; margin-right: 8px; border-radius: 4px;" onclick="window.editAuthSig('${k}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" style="vertical-align:middle;margin-right:4px;"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> EDIT</button>
                        ${(authSigKeys.length > 1 && !a.primary) ? `<button class="btn" style="padding: 6px 12px; font-size: 13px; background-color: #ef4444; color: white; border: none; border-radius: 4px;" onclick="window.deleteAuthSig('${k}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" style="vertical-align:middle;margin-right:4px;"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg> DELETE</button>` : ''}
                    `;
                }

                return `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; text-align: center; color: #475569;">${i + 1}</td>
                    <td style="padding: 12px; font-weight: 500; color: #1e293b;">${nameIcons} ${name}</td>
                    <td style="padding: 12px; color: #475569;">${desig}</td>
                    <td style="padding: 12px; text-align: center;">
                        ${actionsHTML}
                    </td>
                </tr>`;
            }).join('');
            
            html = `<section class="card" style="padding-top: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding: 16px 0; margin-bottom: 16px;">
                <h2 style="font-size: 18px; margin: 0; color: #1e3a8a;">Details of Authorized Signatory</h2>
                <button class="btn accent" style="padding: 8px 16px; font-weight: 600;" onclick="window.addAuthSig()">+ ADD NEW AUTHORIZED SIGNATORY</button>
            </div>
            
            <div style="text-align: right; margin-bottom: 16px; font-size: 13px; color: #475569; display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align: middle;"><circle cx="12" cy="12" r="11" fill="#000"/><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 7s1-4 6-4 6 4 6 4H6z" fill="#fff"/></svg>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="#000" style="vertical-align: middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    Primary Authorized Signatory
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#000" stroke-width="2" fill="none" style="vertical-align: middle;"><circle cx="12" cy="12" r="11"/><path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 7s1-4 6-4 6 4 6 4H6z"/></svg>
                    Authorized Signatory, also Promoter
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="#000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    Authorized Signatory
                </div>
            </div>

            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid #e2e8f0; color: #1e293b; font-size: 14px; font-weight: 700;">
                            <th style="padding: 12px; width: 60px; text-align: center;">Sl No</th>
                            <th style="padding: 12px;">Name</th>
                            <th style="padding: 12px;">Designation / Status</th>
                            <th style="padding: 12px; text-align: center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        </section>`;
        } else {
            const aForm = window.form[currentAuthSigKey];
        html = `<section class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px;">
            <h2 style="font-size: 18px; margin: 0; color: #1e3a8a;">Details of Authorized Signatory (${currentAuthSigKey.toUpperCase()})</h2>\n            <div><button class="btn ghost" style="padding: 8px 16px; border: 1px solid #cbd5e1; margin-right: 8px;" onclick="window.showAuthSigList()">Show list</button></div>
            <span style="font-size: 13px; color: #ef4444;">* indicates mandatory fields</span>
        </div>
        <div style="margin-bottom: 12px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 14px; color: var(--text-main); cursor: pointer;">
                <input type="radio" name="primaryAuthSigGroup" style="width: 18px; height: 18px;" ${aForm.primary ? 'checked' : ''} onchange="if(this.checked) window.handlePrimaryAuthSigChange(true)" /> Primary Authorized Signatory
            </label>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 16px; align-items: start;">
        <div>
        <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px; color: #1e3a8a;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Personal Information</h2>
        
        <div style="margin-bottom: 12px;">
            <label style="font-weight: 500; font-size: 14px; color: var(--text-main);">Name of Person</label>
            <div class="grid3" style="margin-top: 6px; gap: 16px;">
                ${field('First Name <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter First Name" value="${aForm.firstName || ''}" onchange="window.updateForm(currentAuthSigKey + \'.firstName', this.value)" style="" />`)}
                ${field('Middle Name', `<input type="text" placeholder="Enter Middle Name" value="${aForm.middleName || ''}" onchange="window.updatePersonName(currentAuthSigKey, 'middleName', this.value)" style="" />`)}
                ${field('Last Name', `<input type="text" placeholder="Enter Last Name" value="${aForm.lastName || ''}" onchange="window.updatePersonName(currentAuthSigKey, 'lastName', this.value)" style="" />`)}
            </div>
        </div>

        <div style="margin-bottom: 12px;">
            <label style="font-weight: 500; font-size: 14px; color: var(--text-main);">Name of Father</label>
            <div class="grid3" style="margin-top: 6px; gap: 16px;">
                ${field('First Name <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter First Name" value="${aForm.fatherFirstName || ''}" onchange="window.updateForm(currentAuthSigKey + \'.fatherFirstName', this.value)" style="" />`)}
                ${field('Middle Name', `<input type="text" placeholder="Enter Middle Name" value="${aForm.fatherMiddleName || ''}" onchange="window.updateForm(currentAuthSigKey + \'.fatherMiddleName', this.value)" style="" />`)}
                ${field('Last Name', `<input type="text" placeholder="Enter Last Name" value="${aForm.fatherLastName || ''}" onchange="window.updateForm(currentAuthSigKey + \'.fatherLastName', this.value)" style="" />`)}
            </div>
        </div>

        <div class="grid3" style="margin-bottom: 12px; align-items: end; gap: 16px;">
            ${field('Date of Birth <span style="color: #ef4444">*</span>', `<input type="date" value="${aForm.dob || ''}" onchange="window.updateForm(currentAuthSigKey + \'.dob', this.value)" style="" />`)}
            ${field('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; vertical-align:middle;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> Mobile Number <span style="color: #ef4444">*</span>', `<div style="display: flex; "><span style="display:inline-flex; align-items:center; background-color: #f1f5f9; border: 1px solid var(--border-color); border-right: none; padding: 0 12px; border-radius: var(--radius-md) 0 0 var(--radius-md); font-size: 14px; color: var(--text-main);">+91</span><input type="text" placeholder="Enter Mobile Number" pattern="[0-9]{10}" style="border-radius: 0 var(--radius-md) var(--radius-md) 0; flex: 1; " value="${aForm.mobile || ''}" onchange="window.updateForm(currentAuthSigKey + \'.mobile', this.value)" maxlength="10" /></div>`)}
            ${field('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; vertical-align:middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email Address <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Email Address" value="${aForm.email || ''}" onchange="window.updateForm(currentAuthSigKey + \'.email', this.value)" style="" />`)}
        </div>

        <div class="grid" style="grid-template-columns: 1fr 2fr; gap: 16px; margin-bottom: 12px;">
            <div class="field">
                <label style="font-size: 14px;">Gender <span style="color: #ef4444">*</span></label>
                <div style="display: flex; gap: 20px; margin-top: 8px; align-items: center;">
                    <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; color: var(--text-main); cursor: pointer;"><input type="radio" name="auth_gender" value="Male" ${aForm.gender === 'Male' ? 'checked' : ''} onchange="window.updateForm(currentAuthSigKey + \'.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Male</label>
                    <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; color: var(--text-main); cursor: pointer;"><input type="radio" name="auth_gender" value="Female" ${aForm.gender === 'Female' ? 'checked' : ''} onchange="window.updateForm(currentAuthSigKey + \'.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Female</label>
                    <label style="display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; color: var(--text-main); cursor: pointer;"><input type="radio" name="auth_gender" value="Others" ${aForm.gender === 'Others' ? 'checked' : ''} onchange="window.updateForm(currentAuthSigKey + \'.gender', this.value)" style="width: 18px; height: 18px; margin: 0;" /> <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Others</label>
                </div>
            </div>

        </div>

        <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-top: 24px; margin-bottom: 12px;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg> Identity Information</h2>
        
        <div class="grid3" style="margin-bottom: 12px; align-items: center; gap: 16px;">
            ${field('Designation / Status <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Designation" value="${aForm.designation || ''}" onchange="window.updateForm(currentAuthSigKey + \'.designation', this.value)" style="" />`)}
            ${field('Director Identification Number <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter DIN Number" value="${aForm.din || ''}" onchange="window.updateForm(currentAuthSigKey + \'.din', this.value)" style="" />`)}
        </div>

        <div class="grid3" style="margin-bottom: 12px; gap: 16px;">
            ${field('PAN <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter PAN" value="${aForm.pan || ''}" onchange="window.updateForm(currentAuthSigKey + \'.pan', this.value)" style="text-transform:uppercase; " maxlength="10" pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}" />`)}
            ${field('Passport Number (In case of Foreigner)', `<input type="text" placeholder="Enter Passport Number" value="${aForm.passport || ''}" onchange="window.updateForm(currentAuthSigKey + \'.passport', this.value)" style="" />`)}
        </div>
        </div>
        <div>
        <h2 style="font-size: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg> Residential Address</h2>
        
        <div style="margin-bottom: 12px; font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 500;">Address Validation Info</span>
            <span style="position: relative; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #333; color: #fff; border-radius: 50%; font-size: 12px; font-weight: bold; cursor: help;" onmouseover="this.querySelector('.address-tooltip-text').style.display='block'" onmouseout="this.querySelector('.address-tooltip-text').style.display='none'">
                ?
                <div class="address-tooltip-text" style="display: none; position: absolute; left: 25px; top: -10px; width: 350px; background-color: var(--primary); border: 1px solid var(--primary); padding: 12px; border-radius: var(--radius-md); font-size: 12px; color: #ffffff; font-style: normal; line-height: 1.4; z-index: 100; box-shadow: var(--shadow-lg); font-weight: normal; text-align: left;">
                    i. Please be aware that the GST system incorporates mandatory address validations for accuracy and uniformity. These include front-end validations upon entry and back-end cross-checks with GST system geocoding engine.<br><br>
                    ii. Users must ensure that addresses entered align with these validations and any corresponding address proof. Your adherence helps maintain system integrity. Thank you for your cooperation.
                </div>
            </span>
        </div>


        <div class="grid3" style="margin-bottom: 12px; gap: 16px;">
            ${field('Country <span style="color: #ef4444">*</span>', `<select onchange="window.updateForm(currentAuthSigKey + \'.res_country', this.value)" style="background-color: #f1f5f9; cursor: not-allowed; " readonly><option value="India" selected>India</option></select>`)}
            ${field('PIN Code <span style="color: #ef4444">*</span>', `<div style="position:relative"><input type="text" placeholder="Enter PIN Code" value="${aForm.res_pincode || ''}" oninput="searchPincode(this.value, currentAuthSigKey + \'.res_pincode')" onfocus="searchPincode(this.value, currentAuthSigKey + \'.res_pincode')" onblur="setTimeout(() => { const el = document.getElementById('pincode_suggestions'); if(el) el.style.display='none'; }, 200)" maxlength="6" pattern="[0-9]{6}" autocomplete="off" style="" /><ul id="pincode_suggestions" style="position:absolute; display:none; background:#fff; border:1px solid var(--border-color); width:100%; max-height:150px; overflow-y:auto; list-style:none; margin:0; padding:0; z-index:10; border-radius:var(--radius-sm); box-shadow:var(--shadow-md);"></ul></div>`)}
            ${field('State <span style="color: #ef4444">*</span>', `<select onchange="window.aForm.res_state=this.value; window.aForm.res_district=''; if(window.fetchAndSetDistricts) window.fetchAndSetDistricts(this.value, renderContent); else renderContent()" style=""><option value="">Enter State Name</option>${(window.fetchedStates || []).map(s => `<option value="${s}" ${aForm.res_state === s ? 'selected' : ''}>${s}</option>`).join('')}${aForm.res_state && !(window.fetchedStates || []).includes(aForm.res_state) ? `<option value="${aForm.res_state}" selected>${aForm.res_state}</option>` : ''}</select>`)}
        </div>

        <div class="grid3" style="margin-bottom: 12px; gap: 16px;">
            ${field('District <span style="color: #ef4444">*</span>', `<select onchange="window.updateForm(currentAuthSigKey + \'.res_district', this.value)" style=""><option value="">Enter District Name</option>${getDistricts(aForm.res_state || '').map(d => `<option value="${d}" ${aForm.res_district === d ? 'selected' : ''}>${d}</option>`).join('')}${aForm.res_district && !getDistricts(aForm.res_state || '').includes(aForm.res_district) ? `<option value="${aForm.res_district}" selected>${aForm.res_district}</option>` : ''}</select>`)}
            ${field('City / Town / Village <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter City / Town / Village" value="${aForm.res_city || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_city', this.value)" style="" />`)}
            ${field('Locality/Sub Locality', `<input type="text" placeholder="Enter Locality / Sublocality" value="${aForm.res_locality || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_locality', this.value)" style="" />`)}
        </div>

        <div class="grid3" style="margin-bottom: 12px; gap: 16px;">
            ${field('Road / Street <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Road / Street / Lane" value="${aForm.res_road || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_road', this.value)" style="" />`)}
            ${field('Name of the Premises / Building', `<input type="text" placeholder="Enter Name of Premises / Building" value="${aForm.res_buildingName || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_buildingName', this.value)" style="" />`)}
            ${field('Building No. / Flat No. <span style="color: #ef4444">*</span>', `<input type="text" placeholder="Enter Building No. / Flat No. / Door No." value="${aForm.res_buildingNo || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_buildingNo', this.value)" style="" />`)}
        </div>

        <div class="grid3" style="margin-bottom: 12px; gap: 16px;">
            ${field('Floor No.', `<input type="text" placeholder="Enter Floor No." value="${aForm.res_floor || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_floor', this.value)" style="" />`)}
            ${field('Nearby Landmark', `<input type="text" placeholder="Enter Nearby Landmark" value="${aForm.res_landmark || ''}" onchange="window.updateForm(currentAuthSigKey + \'.res_landmark', this.value)" style="" />`)}
        </div>
        <h3 style="font-size: 18px; font-weight: 600; color: #1e3a8a; margin: 24px 0 16px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
            Document Upload
        </h3>
        <div style="border: 1px solid #e2e8f0; padding: 16px; border-radius: var(--radius-md);">
            <div style="margin-bottom: 12px;">
                ${field('Proof of details of authorized signatory <span style="color: #ef4444">*</span>', `<select style="width: 100%; padding: 8px 12px;  border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 14px; margin-bottom: 8px; outline: none;" onchange="window.form['${currentAuthSigKey}'].authSigProofType = this.value; renderContent();"><option value="">Select</option><option value="Letter of Authorisation" ${aForm.authSigProofType === 'Letter of Authorisation' ? 'selected' : ''}>Letter of Authorisation</option><option value="Copy of resolution passed by BoD / Managing Committee" ${aForm.authSigProofType === 'Copy of resolution passed by BoD / Managing Committee' ? 'selected' : ''}>Copy of resolution passed by BoD / Managing Committee</option></select>`)}
                <p style="font-size: 12px; color: #64748b; margin-top: 4px;">ℹ File with PDF or JPEG format is only allowed. Max size 1 MB.</p>
                <input type="file" accept=".pdf, .jpeg, .jpg" onchange="window.handleFileUpload(this, 'pdf/jpeg', 1024, (data, filename) => { window.form['${currentAuthSigKey}'].authSigProofFile = data; window.form['${currentAuthSigKey}'].authSigProofFileName = filename; renderContent(); })" style="font-size: 14px; margin-top: 4px; ${aForm.authSigProofFile ? 'display: none;' : ''}" />
                ${aForm.authSigProofFile ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 500; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;"><span style="word-break: break-all;">📄 ${aForm.authSigProofFileName || 'Uploaded Document'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form['${currentAuthSigKey}'].authSigProofFile, () => { window.form['${currentAuthSigKey}'].authSigProofFile = ''; window.form['${currentAuthSigKey}'].authSigProofFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form['${currentAuthSigKey}'].authSigProofFile); return false;" class="btn-doc-view">View</button></div></div>` : ''}
            </div>
            <hr style="border-top: 1px solid #e2e8f0; margin-bottom: 12px;" />
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                <div style="flex: 1; min-width: 300px;">
                    <div style="font-size: 14px; font-weight: 500; color: #1e293b; margin-bottom: 4px;">Upload Photograph (of person whose information has been given above) <span style="color: #ef4444">*</span></div>
                    <p style="font-size: 12px; color: #64748b; margin-top: 4px;">ℹ Only JPEG file format is allowed. Max size 100 KB.</p>
                    <input type="file" accept="image/jpeg, image/jpg" onchange="window.handleFileUpload(this, 'jpeg', 100, (data, filename) => { window.form['${currentAuthSigKey}'].authSigPhotoFile = data; window.form['${currentAuthSigKey}'].authSigPhotoFileName = filename; renderContent(); })" style="font-size: 14px; margin-top: 4px; ${aForm.authSigPhotoFile ? 'display: none;' : ''}" />
                    ${aForm.authSigPhotoFile ? `<div style="margin-top: 8px; font-size: 13px; color: #166534; font-weight: 500; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 8px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;"><span style="word-break: break-all;">📄 ${aForm.authSigPhotoFileName || 'Uploaded Photograph'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form['${currentAuthSigKey}'].authSigPhotoFile, () => { window.form['${currentAuthSigKey}'].authSigPhotoFile = ''; window.form['${currentAuthSigKey}'].authSigPhotoFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form['${currentAuthSigKey}'].authSigPhotoFile); return false;" class="btn-doc-view">View</button></div></div>` : ''}
                </div>
            </div>
        </div>
        </div>
        </div>
        <div><button class="btn accent" style="padding: 10px 20px; font-weight: 600; margin-top: 20px;" onclick="window.showAuthSigList()">Save Signatory & Show list</button></div>
        </section>`;
        }
    } else if (step === 3) {
        html = `<section class="card">
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; align-items: start;">

        <!-- Column 1 -->
        <div style="padding-right: 24px;">
            <h2 style="font-size: 20px; font-weight: 700; border-bottom: 2px solid var(--border-color); padding-bottom: 16px; margin-bottom: 16px; color: #1e3a8a; text-transform: uppercase;"><span style="color: #1e3a8a; font-weight: 900;">|</span> Address</h2>
            
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 12px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">PIN CODE <span style="color: #ef4444">*</span></span>', `<div style="position:relative"><input id="ppob_pincode" type="text" placeholder="PIN Code" value="${form.ppob_pincode || ''}" oninput="searchPincode(this.value, 'ppob_pincode')" onfocus="searchPincode(this.value, 'ppob_pincode')" onblur="setTimeout(() => { const el = document.getElementById('pincode_suggestions'); if(el) el.style.display='none'; }, 200); if(window.fetchStateJurisdictions && this.value.length === 6) window.fetchStateJurisdictions(renderContent);" maxlength="6" pattern="[0-9]{6}" autocomplete="off" style="" /><ul id="pincode_suggestions" style="position:absolute; display:none; background:#fff; border:1px solid var(--border-color); width:100%; max-height:200px; overflow-y:auto; list-style:none; margin:0; padding:0; z-index:10; border-radius:var(--radius-sm); box-shadow:var(--shadow-md);"></ul></div>`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">STATE</span>', `<select id="ppob_state" onchange="window.form.ppob_state=this.value; window.form.ppob_district=''; if(window.fetchAndSetDistricts) window.fetchAndSetDistricts(this.value, () => { if(window.fetchStateJurisdictions) window.fetchStateJurisdictions(renderContent); else renderContent(); }); else { if(window.fetchStateJurisdictions) window.fetchStateJurisdictions(renderContent); else renderContent(); }" style=""><option value="">State</option>${(window.fetchedStates || []).map(s => `<option value="${s}" ${form.ppob_state === s ? 'selected' : ''}>${s}</option>`).join('')}${form.ppob_state && !(window.fetchedStates || []).includes(form.ppob_state) ? `<option value="${form.ppob_state}" selected>${form.ppob_state}</option>` : ''}</select>`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">DISTRICT <span style="color: #ef4444">*</span></span>', `<select id="ppob_district" onchange="window.updateForm('ppob_district', this.value)" style=""><option value="">District</option>${getDistricts(form.ppob_state || '').map(d => `<option value="${d}" ${form.ppob_district === d ? 'selected' : ''}>${d}</option>`).join('')}${form.ppob_district && !getDistricts(form.ppob_state || '').includes(form.ppob_district) ? `<option value="${form.ppob_district}" selected>${form.ppob_district}</option>` : ''}</select>`)}
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 12px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">CITY / TOWN <span style="color: #ef4444">*</span></span>', `<input id="ppob_city" type="text" placeholder="City" value="${form.ppob_city || ''}" onchange="window.updateForm('ppob_city', this.value)" style="" />`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">LOCALITY</span>', `<input id="ppob_locality" type="text" placeholder="Locality" value="${form.ppob_locality || ''}" onchange="window.updateForm('ppob_locality', this.value)" style="" />`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">STREET <span style="color: #ef4444">*</span></span>', `<input id="ppob_street" type="text" placeholder="Street" value="${form.ppob_street || ''}" onchange="window.updateForm('ppob_street', this.value)" style="" />`)}
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 12px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">BUILDING</span>', `<input type="text" placeholder="Building" value="${form.ppob_building || ''}" onchange="window.updateForm('ppob_building', this.value)" style="" />`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">FLAT NO. <span style="color: #ef4444">*</span></span>', `<input type="text" placeholder="No." value="${form.ppob_flatNo || ''}" onchange="window.updateForm('ppob_flatNo', this.value)" style="" />`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">FLOOR</span>', `<input type="text" placeholder="Floor" value="${form.ppob_floor || ''}" onchange="window.updateForm('ppob_floor', this.value)" style="" />`)}
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">LANDMARK</span>', `<input type="text" placeholder="Landmark" value="${form.ppob_landmark || ''}" onchange="window.updateForm('ppob_landmark', this.value)" style="" />`)}
            </div>

            <h2 style="font-size: 20px; font-weight: 700; border-bottom: 2px solid var(--border-color); padding-bottom: 16px; margin-bottom: 16px; color: #1e3a8a; text-transform: uppercase;"><span style="color: #1e3a8a; font-weight: 900;">|</span> Contact Information</h2>
            
            <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">OFFICE EMAIL <span style="color: #ef4444">*</span></span>', `<input type="text" placeholder="Email" value="${form.ppob_email || ''}" onchange="window.updateForm('ppob_email', this.value)" style="" />`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">MOBILE <span style="color: #ef4444">*</span></span>', `<div style="display: flex; "><input type="text" value="+91" readonly style="width: 56px; background-color: #f1f5f9; border-radius: var(--radius-md) 0 0 var(--radius-md); border-right: none; text-align: center; font-size:14px; padding:12px; height: 100%; box-sizing: border-box; margin: 0;" /><input type="text" placeholder="Mobile" pattern="[0-9]{10}" style="border-radius: 0 var(--radius-md) var(--radius-md) 0; flex: 1; height: 100%; box-sizing: border-box; margin: 0;" value="${form.ppob_mobile || ''}" onchange="window.updateForm('ppob_mobile', this.value)" /></div>`)}
            </div>

            <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">OFFICE FAX</span>', `<div style="display: flex; "><input type="text" placeholder="STD" style="width: 64px; border-radius: var(--radius-md) 0 0 var(--radius-md); border-right: none; font-size:16px; padding:12px; height: 100%; box-sizing: border-box; margin: 0;" value="${form.ppob_faxStdCode || ''}" onchange="window.updateForm('ppob_faxStdCode', this.value)" /><input type="text" placeholder="Fax" style="border-radius: 0 var(--radius-md) var(--radius-md) 0; flex: 1; height: 100%; box-sizing: border-box; margin: 0;" value="${form.ppob_fax || ''}" onchange="window.updateForm('ppob_fax', this.value)" /></div>`)}
            </div>
        </div>

        <!-- Column 2 -->
        <div style="border-left: 1px solid var(--border-color); border-right: 1px solid var(--border-color); padding: 0 24px;">
            <div style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 12px;">State Jurisdiction</div>
            <div style="margin-bottom: 16px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">SECTOR / WARD <span style="color: #ef4444">*</span></span>', `<select onchange="window.updateForm('ppob_stateJurisdiction', this.value)" style=""><option value="">Select</option>${(window.fetchedStateJurisdictions || []).map(j => `<option value="${j}" ${form.ppob_stateJurisdiction === j ? 'selected' : ''}>${j}</option>`).join('')}</select>`)}
            </div>

            <div style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 12px;">Center Jurisdiction</div>
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">COMMISSIONERATE <span style="color: #ef4444">*</span></span>', `<select onchange="window.form.ppob_commissionerate=this.value; if(window.fetchDivisions) window.fetchDivisions(renderContent)" style=""><option value="">Select</option>${(window.fetchedCommissionerates || []).map(j => `<option value="${j.c}" ${form.ppob_commissionerate === j.c ? 'selected' : ''}>${j.n}</option>`).join('')}</select>`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">DIVISION <span style="color: #ef4444">*</span></span>', `<select onchange="window.form.ppob_division=this.value; if(window.fetchRanges) window.fetchRanges(renderContent)" style=""><option value="">Select</option>${(window.fetchedDivisions || []).map(j => `<option value="${j.c}" ${form.ppob_division === j.c ? 'selected' : ''}>${j.n}</option>`).join('')}</select>`)}
                ${field('<span style="text-transform:uppercase; font-size:14px; font-weight:700;">RANGE <span style="color: #ef4444">*</span></span>', `<select onchange="window.updateForm('ppob_range', this.value)" style=""><option value="">Select</option>${(window.fetchedRanges || []).map(j => `<option value="${j.c}" ${form.ppob_range === j.c ? 'selected' : ''}>${j.n}</option>`).join('')}</select>`)}
            </div>

            <div style="margin-bottom: 16px;">
                ${field('<span style="font-size:14px; font-weight:700; color: #1e3a8a; text-transform:uppercase;">NATURE OF POSSESSION OF PREMISES <span style="color: #ef4444">*</span></span>', `<select style="width: 100%; padding: 12px 16px;  border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 16px; outline: none;" onchange="window.form.ppob_natureOfPossession=this.value; renderContent();">
                    <option value="">Select</option>
                    <option value="Consent" ${form.ppob_natureOfPossession === 'Consent' ? 'selected' : ''}>Consent</option>
                    <option value="Leased" ${form.ppob_natureOfPossession === 'Leased' ? 'selected' : ''}>Leased</option>
                    <option value="Others" ${form.ppob_natureOfPossession === 'Others' ? 'selected' : ''}>Others</option>
                    <option value="Own" ${form.ppob_natureOfPossession === 'Own' ? 'selected' : ''}>Own</option>
                    <option value="Rented" ${form.ppob_natureOfPossession === 'Rented' ? 'selected' : ''}>Rented</option>
                    <option value="Shared" ${form.ppob_natureOfPossession === 'Shared' ? 'selected' : ''}>Shared</option>
                </select>`)}
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 14px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px; text-transform:uppercase;">DOCUMENT UPLOAD <span style="color: #ef4444">*</span></div>
                <div style="font-size: 14px; color: var(--text-main); margin-bottom: 8px;">Proof of Principal Place of Business</div>
                <select style="width: 100%; padding: 12px 16px;  border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 16px; margin-bottom: 16px; outline: none;" onchange="window.form.ppob_doc = this.value; renderContent();">
                    <option value="">Select</option>
                    ${(form.ppob_natureOfPossession === 'Consent' || form.ppob_natureOfPossession === 'Shared') ? `
                    <option value="Consent Letter" ${form.ppob_doc === 'Consent Letter' ? 'selected' : ''}>Consent Letter</option>
                    <option value="Electricity Bill" ${form.ppob_doc === 'Electricity Bill' ? 'selected' : ''}>Electricity Bill</option>
                    <option value="Legal ownership document" ${form.ppob_doc === 'Legal ownership document' ? 'selected' : ''}>Legal ownership document</option>
                    <option value="Municipal Khata Copy" ${form.ppob_doc === 'Municipal Khata Copy' ? 'selected' : ''}>Municipal Khata Copy</option>
                    <option value="Property Tax Receipt" ${form.ppob_doc === 'Property Tax Receipt' ? 'selected' : ''}>Property Tax Receipt</option>
                    ` : (form.ppob_natureOfPossession === 'Leased' || form.ppob_natureOfPossession === 'Rented') ? `
                    <option value="Electricity Bill" ${form.ppob_doc === 'Electricity Bill' ? 'selected' : ''}>Electricity Bill</option>
                    <option value="Legal ownership document" ${form.ppob_doc === 'Legal ownership document' ? 'selected' : ''}>Legal ownership document</option>
                    <option value="Municipal Khata Copy" ${form.ppob_doc === 'Municipal Khata Copy' ? 'selected' : ''}>Municipal Khata Copy</option>
                    <option value="Property Tax Receipt" ${form.ppob_doc === 'Property Tax Receipt' ? 'selected' : ''}>Property Tax Receipt</option>
                    <option value="Rent / Lease agreement" ${form.ppob_doc === 'Rent / Lease agreement' ? 'selected' : ''}>Rent / Lease agreement</option>
                    <option value="Rent receipt with NOC (In case of no/expired agreement)" ${form.ppob_doc === 'Rent receipt with NOC (In case of no/expired agreement)' ? 'selected' : ''}>Rent receipt with NOC (In case of no/expired agreement)</option>
                    ` : form.ppob_natureOfPossession === 'Others' ? `
                    <option value="Legal ownership document" ${form.ppob_doc === 'Legal ownership document' ? 'selected' : ''}>Legal ownership document</option>
                    ` : form.ppob_natureOfPossession === 'Own' ? `
                    <option value="Electricity Bill" ${form.ppob_doc === 'Electricity Bill' ? 'selected' : ''}>Electricity Bill</option>
                    <option value="Legal ownership document" ${form.ppob_doc === 'Legal ownership document' ? 'selected' : ''}>Legal ownership document</option>
                    <option value="Municipal Khata Copy" ${form.ppob_doc === 'Municipal Khata Copy' ? 'selected' : ''}>Municipal Khata Copy</option>
                    <option value="Property Tax Receipt" ${form.ppob_doc === 'Property Tax Receipt' ? 'selected' : ''}>Property Tax Receipt</option>
                    ` : ''}
                </select>
                <div style="display:flex; align-items:center; gap: 16px;">
                    <button style="background: #e2e8f0; border: 1px solid var(--border-color); padding: 10px 24px; font-size: 15px; border-radius: var(--radius-md); cursor: pointer;" onclick="this.nextElementSibling.click(); return false;">Choose File</button>
                    <input type="file" accept=".pdf, .jpeg, .jpg" onchange="window.handleFileUpload(this, 'pdf/jpeg', 1024, (data, filename) => { window.form.ppob_docFile = data; window.form.ppob_docFileName = filename; renderContent(); })" style="display: none;" />
                    <span style="font-size: 15px; color: var(--text-main);">${form.ppob_docFile ? `<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 8px;"><span style="color: #166534; font-weight: 500; word-break: break-all;">📄 ${form.ppob_docFileName || 'Uploaded Document'}</span> <div style="display: flex; gap: 12px;"><button onclick="window.deleteFile(window.form.ppob_docFile, () => { window.form.ppob_docFile = ''; window.form.ppob_docFileName = ''; renderContent(); }); return false;" class="btn-doc-delete">Delete</button> <button onclick="window.viewDocument(window.form.ppob_docFile); return false;" class="btn-doc-view">View</button></div></div>` : 'No file chosen'}</span>
                </div>
            </div>
        </div>

        <!-- Column 3 -->
        <div style="padding-left: 48px;">
            <h2 style="font-size: 20px; font-weight: 700; border-bottom: 2px solid var(--border-color); padding-bottom: 16px; margin-bottom: 16px; color: #1e3a8a;"><span style="color: #1e3a8a; font-weight: 900;">|</span> Nature of Business Activity <span style="color: #ef4444">*</span></h2>
            
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.bondedWarehouse ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.bondedWarehouse=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Bonded Warehouse</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.factoryManufacturing ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.factoryManufacturing=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Factory / Manufacturing</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.leasingBusiness ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.leasingBusiness=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Leasing Business</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.retailBusiness ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.retailBusiness=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Retail Business</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.worksContract ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.worksContract=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Works Contract</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.eouStpEhtp ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.eouStpEhtp=this.checked" style="width: 20px; height: 20px; margin: 0;" /> EOU / STP / EHTP</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.import ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.import=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Import</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.officeSaleOffice ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.officeSaleOffice=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Office / Sale Office</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.warehouseDepot ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.warehouseDepot=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Warehouse / Depot</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.export ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.export=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Export</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.supplierOfServices ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.supplierOfServices=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Supplier of Services</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.recipientOfGoodsOrServices ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.recipientOfGoodsOrServices=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Recipient of Goods/Services</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.wholesaleBusiness ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.wholesaleBusiness=this.checked" style="width: 20px; height: 20px; margin: 0;" /> Wholesale Business</label>
                <label style="display: flex; align-items: center; gap: 12px; font-size: 16px; color: var(--text-main); cursor: pointer;"><input type="checkbox" ${form.ppob_natureOfBusiness?.others ? 'checked' : ''} onchange="window.form.ppob_natureOfBusiness.others=this.checked; renderContent();" style="width: 20px; height: 20px; margin: 0;" /> Others</label>
                ${form.ppob_natureOfBusiness?.others ? `
                <div style="padding-left: 32px; margin-top: -10px;">
                    <input type="text" placeholder="Please specify others" value="${form.ppob_natureOfBusiness?.othersText || ''}" onchange="window.form.ppob_natureOfBusiness.othersText=this.value" style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 15px; outline: none; background: #fff;" />
                </div>
                ` : ''}
            </div>
        </div>

        </div>
        </section>`;
    } else if (step === 4) {
        html = `<section class="card" style="padding: 32px; overflow: hidden; border: 1px solid var(--border-color);">
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; align-items: start;">
                
                <!-- Goods Column -->
                <div style="border-right: 1px solid var(--border-color); padding-right: 32px; min-height: 400px;">
                    <h2 style="font-size: 18px; color: #1e3a8a; margin: 0 0 16px 0; font-weight: 700;">Details of Goods</h2>
                    <div style="font-size: 14px; color: var(--text-main); margin-bottom: 16px;">Please specify top 5 Commodities</div>
                    <hr style="border: none; border-top: 1px solid var(--border-color); margin-bottom: 12px;" />
                    <div style="position: relative;">
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">Search HSN Chapter by Name or Code</div>
                        <input type="text" id="hsn-search-input" placeholder="Search HSN Chapter" style="flex: 1; border: 1px solid var(--border-color); padding: 12px 16px; border-radius: var(--radius-sm); outline: none; font-size: 16px; height: 48px; box-sizing: border-box; width: 100%;" oninput="searchHSN(this.value)" />
                        <div id="hsn-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--border-color); border-radius: var(--radius-sm); max-height: 200px; overflow-y: auto; z-index: 10; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);"></div>
                    </div>
                    <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px;">
                        ${(Array.isArray(form.goods_hsn) ? form.goods_hsn : []).map((item, idx) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                                <span style="font-size: 14px; color: var(--text-main);">${item}</span>
                                <button style="color: #ef4444; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0; font-size: 13px;" onclick="window.removeGoodsItem(${idx}); return false;">Delete</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Services Column -->
                <div style="border-right: 1px solid var(--border-color); padding-right: 32px; min-height: 400px;">
                    <h2 style="font-size: 18px; color: #1e3a8a; margin: 0 0 16px 0; font-weight: 700;">Details of Services</h2>
                    <div style="font-size: 14px; color: var(--text-main); margin-bottom: 16px;">Please specify top 5 Services</div>
                    <hr style="border: none; border-top: 1px solid var(--border-color); margin-bottom: 12px;" />
                    <div style="position: relative;">
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">Search by Name or Code</div>
                        <input type="text" id="sac-search-input" placeholder="Search Service Classification Code" style="flex: 1; border: 1px solid var(--border-color); padding: 12px 16px; border-radius: var(--radius-sm); outline: none; font-size: 16px; height: 48px; box-sizing: border-box; width: 100%;" oninput="searchSAC(this.value)" />
                        <div id="sac-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--border-color); border-radius: var(--radius-sm); max-height: 200px; overflow-y: auto; z-index: 10; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);"></div>
                    </div>
                    <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px;">
                        ${(Array.isArray(form.goods_sac) ? form.goods_sac : []).map((item, idx) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                                <span style="font-size: 14px; color: var(--text-main);">${item}</span>
                                <button style="color: #ef4444; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0; font-size: 13px;" onclick="window.removeServicesItem(${idx}); return false;">Delete</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- State Specific Column -->
                <div style="min-height: 400px;">
                    <h2 style="font-size: 18px; color: #1e3a8a; margin: 0 0 16px 0; font-weight: 700;">State Specific Info</h2>
                    <div style="font-size: 14px; color: var(--text-main); margin-bottom: 16px;">Provide state-specific details</div>
                    <hr style="border: none; border-top: 1px solid var(--border-color); margin-bottom: 12px;" />
                    
                    <div style="display: flex; flex-direction: column; gap: 20px;">

                        ${ELECTRICITY_BOARDS[form.state] ? field('<span style="font-size: 13px; font-weight: 600;">Electricity Board <span style="color: #ef4444">*</span></span>', `<select onchange="window.updateForm('stateSpecific_electricityBoard', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;"><option value="">Select</option>${(ELECTRICITY_BOARDS[form.state]).map(board => `<option value="${board}" ${form.stateSpecific_electricityBoard === board ? 'selected' : ''}>${board}</option>`).join('')}</select>`) : ''}
                        ${ELECTRICITY_BOARDS[form.state] ? field('<span style="font-size: 13px; font-weight: 600;">Consumer Number <span style="color: #ef4444">*</span></span>', `<input type="text" placeholder="Enter Consumer Number" value="${form.stateSpecific_electricityConsumerNo || ''}" onchange="window.updateForm('stateSpecific_electricityConsumerNo', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;" />`) : ''}
                        ${field('<span style="font-size: 13px; font-weight: 600;">PT Employee Code (EC)</span>', `<input type="text" placeholder="Enter PT E.C Number" value="${form.stateSpecific_ptEcNo || ''}" onchange="window.updateForm('stateSpecific_ptEcNo', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;" />`)}
                        ${field('<span style="font-size: 13px; font-weight: 600;">PT Registration (RC)</span>', `<input type="text" placeholder="Enter PT R.C Number" value="${form.stateSpecific_ptRcNo || ''}" onchange="window.updateForm('stateSpecific_ptRcNo', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;" />`)}
                        ${field('<span style="font-size: 13px; font-weight: 600;">State Excise License No.</span>', `<input type="text" placeholder="Enter Excise License Number" value="${form.stateSpecific_exciseLicenseNo || ''}" onchange="window.updateForm('stateSpecific_exciseLicenseNo', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;" />`)}
                        ${field('<span style="font-size: 13px; font-weight: 600;">Excise Licence Holder</span>', `<input type="text" placeholder="Enter Name" value="${form.stateSpecific_exciseLicenseHolder || ''}" onchange="window.updateForm('stateSpecific_exciseLicenseHolder', this.value)" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 14px; height: 44px; box-sizing: border-box;" />`)}
                    </div>
                </div>

            </div>
        </section>`;
    } else if (step === 5) {
        html = `<section class="card"><h2>Review</h2>
        <button class="btn accent" onclick="showPreview();">Complete Application</button>
        </section>`;
    }

    html += `
    <div class="nav">
        <div style="display: flex; gap: 16px;">
            ${step > 0 ? `<button class="btn ghost" onclick="setStep(${step - 1})">Back</button>` : '<div></div>'}
        </div>
        <div style="display: flex; gap: 16px;">
            ${step < STEPS.length - 1 ? `<button class="btn primary" onclick="setStep(${step + 1})">Next</button>` : ''}
        </div>
    </div>`;
    content.innerHTML = html;

    if (step === 2 && !isAuthSigListView && window.isViewingPromoter) {
        const inputs = content.querySelectorAll('input, select, textarea');
        inputs.forEach(el => {
            if (el.name !== 'primaryAuthSigGroup') {
                el.disabled = true;
                el.style.opacity = '0.7';
                el.style.cursor = 'not-allowed';
            }
        });
        const buttons = content.querySelectorAll('button');
        buttons.forEach(b => {
            if (b.innerText.includes('Save Signatory') || b.innerText.includes('Delete') || b.innerText.includes('EDIT')) {
                b.style.display = 'none';
            }
        });
    }

    if (step === 0) {
        updatePanFormatBoxes(form.pan);
    }

    // Initialize maps and autocomplete after DOM updates
    if (typeof initMapsAndAutocomplete === 'function') {
        initMapsAndAutocomplete();
    }
}

window.onload = () => {
    renderSidebar();
    renderContent();
};

let pincodeDebounce;
window.searchPincode = function (query, targetKey) {
    if (targetKey) {
        window.updateForm(targetKey, query);
    } else {
        if (step === 1) form.promoters[0].res_pincode = query;
        else if (step === 2) window.form[currentAuthSigKey].res_pincode = query;
        else if (step === 3) form.ppob_pincode = query;
    }

    const list = document.getElementById('pincode_suggestions');
    if (list) list.style.display = 'none';

    if (query.length === 6) {
        fetchMapplsPincode(query, targetKey);
    }
}

window.fetchMapplsPincode = debounce(async function (pin, targetKey) {
    if (pin.length !== 6) return;

    const results = await mapplsService.searchPincode(pin);
    if (results && results.length > 0) {
        const data = results[0].properties;
        const state = data.state;
        const district = data.district || '';
        const city = data.city || '';

        if (targetKey) {
            const baseKey = targetKey.replace('.res_pincode', '').replace('ppob_pincode', '');
            if (baseKey === '') {
                window.updateForm('ppob_state', state);
                window.updateForm('ppob_district', district);
                window.updateForm('ppob_city', city);
                if (window.fetchStateJurisdictions) {
                    window.fetchStateJurisdictions(renderContent);
                    return;
                }
            } else {
                window.updateForm(baseKey + '.res_state', state);
                window.updateForm(baseKey + '.res_district', district);
                window.updateForm(baseKey + '.res_city', city);
            }
        } else {
            if (step === 1) {
                form.promoters[0].res_state = state;
                form.promoters[0].res_district = district;
                form.promoters[0].res_city = city;
            } else if (step === 2) {
                form.authSig.res_state = state;
                form.authSig.res_district = district;
                form.authSig.res_city = city;
            } else if (step === 3) {
                form.ppob_state = state;
                form.ppob_district = district;
                form.ppob_city = city;
                if (window.fetchStateJurisdictions) {
                    window.fetchStateJurisdictions(renderContent);
                    return;
                }
            }
        }
        renderContent();
    }
}, 500);

let currentMap = null;
let currentMarker = null;

window.initMapsAndAutocomplete = function () {
    if (step === 1 || step === 2 || step === 3) {
        const mapContainer = document.getElementById('leaflet-map');
        if (mapContainer) {
            let lat = 28.6139; // Default to New Delhi
            let lon = 77.2090;

            let f;
            if (step === 1) f = form.promoters[0];
            else if (step === 2) f = form.authSig;
            else if (step === 3) f = form;

            let storedLat = step === 3 ? form.ppob_latitude : null;
            let storedLon = step === 3 ? form.ppob_longitude : null;

            if (storedLat && storedLon) {
                lat = parseFloat(storedLat);
                lon = parseFloat(storedLon);
            }

            try {
                if (!window.mappls) {
                    console.warn("Mappls SDK not loaded yet.");
                    return;
                }

                if (currentMap) {
                    const mapEl = document.getElementById('leaflet-map');
                    if (mapEl) mapEl.innerHTML = '';
                }

                currentMap = new mappls.Map('leaflet-map', {
                    center: [lat, lon],
                    zoom: 13,
                    zoomControl: true,
                    location: true
                });

                currentMarker = new mappls.Marker({
                    map: currentMap,
                    position: { lat: lat, lng: lon },
                    draggable: true
                });

                const handleDrag = async function (e) {
                    const pos = currentMarker.getPosition();
                    if (!pos) return;

                    const pLat = pos.lat;
                    const pLon = pos.lng;

                    const data = await mapplsService.reverseGeocode(pLat, pLon);
                    if (data) {
                        if (step === 3) {
                            window.form.ppob_state = data.state || '';
                            window.form.ppob_district = data.district || '';
                            window.form.ppob_city = data.city || '';
                            window.form.ppob_locality = data.locality || '';
                            window.form.ppob_street = data.street || '';
                            window.form.ppob_pincode = data.postcode || '';
                            window.form.ppob_latitude = pLat;
                            window.form.ppob_longitude = pLon;

                            const elState = document.getElementById('ppob_state');
                            if (elState && window.form.ppob_state) {
                                if (!Array.from(elState.options).some(o => o.value === window.form.ppob_state)) {
                                    elState.add(new Option(window.form.ppob_state, window.form.ppob_state));
                                }
                                elState.value = window.form.ppob_state;
                            }

                            const elDistrict = document.getElementById('ppob_district');
                            if (elDistrict && window.form.ppob_district) {
                                if (!Array.from(elDistrict.options).some(o => o.value === window.form.ppob_district)) {
                                    elDistrict.add(new Option(window.form.ppob_district, window.form.ppob_district));
                                }
                                elDistrict.value = window.form.ppob_district;
                            }

                            const elCity = document.getElementById('ppob_city');
                            if (elCity) elCity.value = window.form.ppob_city;
                            const elLocality = document.getElementById('ppob_locality');
                            if (elLocality) elLocality.value = window.form.ppob_locality;
                            const elStreet = document.getElementById('ppob_street');
                            if (elStreet) elStreet.value = window.form.ppob_street;
                            const elPincode = document.getElementById('ppob_pincode');
                            if (elPincode) elPincode.value = window.form.ppob_pincode;
                            const elLat = document.getElementById('ppob_latitude');
                            if (elLat) elLat.value = window.form.ppob_latitude;
                            const elLon = document.getElementById('ppob_longitude');
                            if (elLon) elLon.value = window.form.ppob_longitude;

                        } else {
                            const f = step === 1 ? window.form.promoters[0] : (step === 2 ? window.form.authSig : null);
                            if (f) {
                                f.res_state = data.state || '';
                                f.res_district = data.district || '';
                                f.res_city = data.city || '';
                                f.res_locality = data.locality || '';
                                f.res_road = data.street || '';
                                f.res_pincode = data.postcode || '';
                                renderContent();
                            }
                        }
                    }
                };

                currentMarker.addListener('dragend', handleDrag);

            } catch (err) {
                console.error("Map initialization error:", err);
            }
        }
    }
}

window.searchAddressAutocomplete = debounce(async function (query) {
    const list = document.getElementById('map_suggestions');
    if (!list) return;

    if (query.length < 3) {
        list.style.display = 'none';
        return;
    }

    const results = await mapplsService.autocomplete(query);
    if (results && results.length > 0) {
        list.innerHTML = results.map(r => {
            const prop = r.properties;
            const label = prop.formatted;
            return `<li style="padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border-color); color: var(--text-main); font-size: 13px;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'" onclick="selectAddressSuggestion('${prop.place_id}')">${label}</li>`;
        }).join('');
        list.style.display = 'block';
    } else {
        list.style.display = 'none';
    }
}, 500);

window.selectAddressSuggestion = async function (eloc) {
    const list = document.getElementById('map_suggestions');
    if (list) list.style.display = 'none';

    if (window.mappls && currentMap) {
        try {
            mappls.pinMarker({
                map: currentMap,
                pin: eloc,
                zoom: 16
            }, function (data) {
                if (currentMarker) {
                    currentMarker.remove();
                }
                currentMarker = data[0];
                currentMarker.setDraggable(true);

                const pos = currentMarker.getPosition();
                mapplsService.reverseGeocode(pos.lat, pos.lng).then(addr => {
                    if (addr) {
                        if (step === 3) {
                            form.ppob_state = addr.state || '';
                            form.ppob_district = addr.district || '';
                            form.ppob_city = addr.city || '';
                            form.ppob_locality = addr.locality || '';
                            form.ppob_street = addr.street || '';
                            form.ppob_pincode = addr.postcode || '';
                            form.ppob_latitude = pos.lat;
                            form.ppob_longitude = pos.lng;
                        } else {
                            const f = step === 1 ? form.promoters[0] : (step === 2 ? form.authSig : null);
                            if (f) {
                                f.res_state = addr.state || '';
                                f.res_district = addr.district || '';
                                f.res_city = addr.city || '';
                                f.res_locality = addr.locality || '';
                                f.res_road = addr.street || '';
                                f.res_pincode = addr.postcode || '';
                            }
                        }
                        if (step === 3 && window.fetchStateJurisdictions) {
                            window.fetchStateJurisdictions(renderContent);
                        } else {
                            renderContent();
                        }
                    }
                });
            });
        } catch (e) {
            console.error('Error selecting suggestion:', e);
        }
    }
};
// Fetch initial states/districts for the State / UT dropdown
window.fetchedStates = [];
window.fetchedStatesMap = {};
window.fetchedDistricts = {};

window.fetchAndSetDistricts = function (stateName, callback) {
    if (!stateName || window.fetchedDistricts[stateName]) {
        if (callback) callback();
        return;
    }
    const stateCode = window.fetchedStatesMap[stateName.toUpperCase()];
    if (!stateCode) {
        if (callback) callback();
        return;
    }
    fetch(`https://reg.gst.gov.in/master/st/${stateCode}/activedistrict`)
        .then(r => r.json())
        .then(data => {
            let items = [];
            if (Array.isArray(data)) items = data;
            else if (data && Array.isArray(data.data)) {
                if (data.data[0] && Array.isArray(data.data[0].n)) items = data.data[0].n;
                else items = data.data;
            }
            if (items.length > 0) {
                window.fetchedDistricts[stateName] = items.map(item => item.n || item.name || item.name_en || item).filter(Boolean);
            }
        })
        .catch(err => console.error("Error fetching districts:", err))
        .finally(() => {
            if (callback) callback();
        });
};

window.fetchedStateJurisdictions = [];
window.fetchStateJurisdictions = function (callback) {
    if (step !== 3) {
        if (callback) callback();
        return;
    }
    const stateName = window.form.ppob_state;
    const pincode = window.form.ppob_pincode;
    const stateCode = stateName ? window.fetchedStatesMap[stateName.toUpperCase()] : null;

    if (!stateCode || !pincode || pincode.length !== 6) {
        window.fetchedStateJurisdictions = [];
        if (callback) callback();
        return;
    }

    fetch(`https://reg.gst.gov.in/master/jursd/bypincode/state/${stateCode}/${pincode}`)
        .then(r => r.json())
        .then(data => {
            let items = [];
            if (data && data.data && data.data[0] && Array.isArray(data.data[0].n)) {
                items = data.data[0].n;
            }
            window.fetchedStateJurisdictions = items.map(item => item.n || item.name || item).filter(Boolean);
        })
        .catch(err => console.error("Error fetching state jurisdictions:", err))
        .finally(() => {
            if (window.fetchCommissionerates) {
                window.fetchCommissionerates(callback);
            } else if (callback) {
                callback();
            }
        });
};

window.fetchedCommissionerates = [];
window.fetchCommissionerates = function (callback) {
    if (step !== 3) {
        if (callback) callback();
        return;
    }
    const stateName = window.form.ppob_state;
    const pincode = window.form.ppob_pincode;
    const stateCode = stateName ? window.fetchedStatesMap[stateName.toUpperCase()] : null;

    if (!stateCode || !pincode || pincode.length !== 6) {
        window.fetchedCommissionerates = [];
        if (callback) callback();
        return;
    }

    fetch(`https://reg.gst.gov.in/master/jursd/bypincode/commisionerate/${stateCode}/${pincode}`)
        .then(r => r.json())
        .then(data => {
            let items = [];
            if (data && Array.isArray(data.data)) {
                items = data.data;
            }
            window.fetchedCommissionerates = items;
            window.form.ppob_commissionerate = '';
            window.fetchedDivisions = [];
            window.form.ppob_division = '';
            window.fetchedRanges = [];
            window.form.ppob_range = '';
        })
        .catch(err => console.error("Error fetching commissionerates:", err))
        .finally(() => {
            if (callback) callback();
        });
};

window.fetchedDivisions = [];
window.fetchDivisions = function (callback) {
    if (step !== 3) { if (callback) callback(); return; }
    const stateName = window.form.ppob_state;
    const pincode = window.form.ppob_pincode;
    const commCode = window.form.ppob_commissionerate;
    const stateCode = stateName ? window.fetchedStatesMap[stateName.toUpperCase()] : null;

    if (!stateCode || !pincode || pincode.length !== 6 || !commCode) {
        window.fetchedDivisions = [];
        if (callback) callback();
        return;
    }

    fetch(`https://reg.gst.gov.in/master/jursd/bypincode/division/${stateCode}/${commCode}/${pincode}`)
        .then(r => r.json())
        .then(data => {
            let items = [];
            if (data && Array.isArray(data.data)) { items = data.data; }
            window.fetchedDivisions = items;
            window.form.ppob_division = '';
            window.fetchedRanges = [];
            window.form.ppob_range = '';
        })
        .catch(err => console.error("Error fetching divisions:", err))
        .finally(() => { if (callback) callback(); });
};

window.fetchedRanges = [];
window.fetchRanges = function (callback) {
    if (step !== 3) { if (callback) callback(); return; }
    const stateName = window.form.ppob_state;
    const pincode = window.form.ppob_pincode;
    const divCode = window.form.ppob_division;
    const stateCode = stateName ? window.fetchedStatesMap[stateName.toUpperCase()] : null;

    if (!stateCode || !pincode || pincode.length !== 6 || !divCode) {
        window.fetchedRanges = [];
        if (callback) callback();
        return;
    }

    fetch(`https://reg.gst.gov.in/master/jursd/bypincode/range/${stateCode}/${divCode}/${pincode}`)
        .then(r => r.json())
        .then(data => {
            let items = [];
            if (data && Array.isArray(data.data)) { items = data.data; }
            window.fetchedRanges = items;
            window.form.ppob_range = '';
        })
        .catch(err => console.error("Error fetching ranges:", err))
        .finally(() => { if (callback) callback(); });
};

fetch('https://reg.gst.gov.in/master/states')
    .then(r => r.json())
    .then(data => {
        let items = [];
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.data)) {
            if (data.data[0] && Array.isArray(data.data[0].n)) {
                items = data.data[0].n;
            } else {
                items = data.data;
            }
        }
        if (items.length > 0) {
            window.fetchedStates = items.map(item => {
                const name = item.n || item.stateName || item.name || item.name_en || item;
                if (item.c) window.fetchedStatesMap[name.toUpperCase()] = item.c;
                return name;
            }).filter(Boolean);
            if (step === 0) renderContent();
        }
    })
    .catch(err => console.error("Error fetching states:", err));

window.calculateProgress = function () {
    let total = 0;
    let filled = 0;
    const skipKeys = ['promoters', 'authSig', 'ppob_natureOfBusiness', 'goods_hsn', 'goods_sac', 'taxpayerType', 'proofOfConstitutionType', 'proofOfConstitutionFile', 'documentForTradeNameFile', 'authSigProofType', 'authSigProofFile', 'authSigPhotoFile', 'promoterPhotoFile', 'ppob_doc', 'ppob_docFile', 'stateSpecific_electricityBoard', 'stateSpecific_electricityConsumerNo', 'stateSpecific_ptEcNo', 'stateSpecific_ptRcNo', 'stateSpecific_exciseLicenseNo', 'stateSpecific_exciseLicenseHolder', 'existingRegistrationType', 'existingRegistrationNo', 'existingRegistrationDate'];

    // Core fields
    for (const key in window.form) {
        if (skipKeys.includes(key)) continue;
        if (key === 'promoters' || key === 'authSig' || key === 'ppob_natureOfBusiness') continue;
        total++;
        if (window.form[key] && window.form[key] !== '') filled++;
    }

    // Promoters
    if (window.form.promoters && window.form.promoters.length > 0) {
        for (const key in window.form.promoters[0]) {
            if (skipKeys.includes(key)) continue;
            total++;
            if (window.form.promoters[0][key] && window.form.promoters[0][key] !== '') filled++;
        }
    }

    // Auth Sig
        // Auth Sig (Multiple)
    for (const key in window.form) {
        if (key.match(/^a\d+$/)) {
            for (const subKey in window.form[key]) {
                if (skipKeys.includes(subKey) || subKey === 'primary') continue;
                total++;
                if (window.form[key][subKey] && window.form[key][subKey] !== '') filled++;
            }
        }
    }

    let percentage = 0;
    if (total > 0) {
        percentage = Math.round((filled / total) * 100);
    }
    if (percentage > 100) percentage = 100;

    const circle = document.getElementById('form-progress-circle');
    const text = document.getElementById('form-progress-text');
    if (circle && text) {
        circle.style.background = `conic-gradient(#22c55e ${percentage}%, #cbd5e1 ${percentage}%)`;
        text.innerText = `${percentage}%`;
    }
};

document.addEventListener('change', function (e) {
    setTimeout(() => {
        if (window.calculateProgress) window.calculateProgress();
    }, 50);
});

// Initial calculation
setTimeout(() => {
    if (window.calculateProgress) window.calculateProgress();
}, 500);

window.addExistingRegistration = function () {
    const typeEl = document.getElementById('existingRegistrationType');
    const noEl = document.getElementById('existingRegistrationNo');
    const dateEl = document.getElementById('existingRegistrationDate');

    let type = typeEl ? typeEl.value : window.form.existingRegistrationType;
    let no = noEl ? noEl.value : window.form.existingRegistrationNo;
    let date = dateEl ? dateEl.value : window.form.existingRegistrationDate;

    if (type && no && date) {
        if (!window.form.existingRegistrations) window.form.existingRegistrations = [];
        window.form.existingRegistrations.push({ type, no, date });
        window.form.existingRegistrationType = '';
        window.form.existingRegistrationNo = '';
        window.form.existingRegistrationDate = '';
        renderContent();
    } else {
        alert("Please fill out Type of Registration, Registration No., and Date of Registration before adding.");
    }
};

window.deleteExistingRegistration = function (index) {
    if (window.form.existingRegistrations) {
        window.form.existingRegistrations.splice(index, 1);
        renderContent();
    }
};

window.editExistingRegistration = function (index) {
    if (window.form.existingRegistrations) {
        const item = window.form.existingRegistrations[index];
        window.form.existingRegistrationType = item.type;
        window.form.existingRegistrationNo = item.no;
        window.form.existingRegistrationDate = item.date;
        window.form.existingRegistrations.splice(index, 1);
        renderContent();
    }
};

window.viewDocument = function(base64Data) {
    if (!base64Data) return;
    const win = window.open();
    if (!win) {
        alert("Please allow popups to view documents.");
        return;
    }
    win.document.write('<!DOCTYPE html><html><head><title>Document Viewer</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f3f4f6;">');
    if (base64Data.startsWith('data:application/pdf')) {
        win.document.write('<iframe src="' + base64Data + '" frameborder="0" style="width:100%; height:100%;"></iframe>');
    } else {
        win.document.write('<img src="' + base64Data + '" style="max-width:100%; max-height:100%; object-fit:contain;" />');
    }
    win.document.write('</body></html>');
    win.document.close();
};

window.handleFileUpload = function (input, type, maxKB, updateFn) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const sizeKB = file.size / 1024;
    const ext = file.name.split('.').pop().toLowerCase();
    
    let validExt = [];
    if (type === 'pdf/jpeg') validExt = ['pdf', 'jpeg', 'jpg'];
    else if (type === 'jpeg') validExt = ['jpeg', 'jpg'];

    // If it's not a valid format, but it's an image (like png), we can auto-convert it if 'type' allows jpeg!
    const isImage = file.type.startsWith('image/');
    
    if (!validExt.includes(ext) && !isImage) {
        alert(`Invalid file type. Only ${type.toUpperCase()} allowed.`);
        input.value = '';
        return;
    }

    if (sizeKB > maxKB) {
        if (isImage) {
            // Auto compress image
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Scale down to max 1200px width/height for compression
                    if (width > 1200 || height > 1200) {
                        const ratio = Math.min(1200 / width, 1200 / height);
                        width = width * ratio;
                        height = height * ratio;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Try quality until it fits, starting at 0.7
                    let quality = 0.7;
                    let dataUrl = canvas.toDataURL('image/jpeg', quality);
                    
                    while (dataUrl.length / 1370 > maxKB && quality > 0.1) {
                        quality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    
                    if (dataUrl.length / 1370 > maxKB) {
                        alert(`Could not compress image below ${maxKB}KB. Please choose a smaller image.`);
                        input.value = '';
                    } else {
                        // Successfully compressed! Rename to .jpg
                        const newName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                        updateFn(dataUrl, newName);
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
            return;
        } else {
            alert(`File size exceeds the limit of ${maxKB >= 1024 ? (maxKB / 1024) + ' MB' : maxKB + ' KB'}. Please compress your PDF manually.`);
            input.value = '';
            return;
        }
    }

    if (!validExt.includes(ext) && isImage && (type === 'jpeg' || type === 'pdf/jpeg')) {
        // It's an image but wrong extension (like .png). Convert to .jpg
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                const newName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                updateFn(dataUrl, newName);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        return;
    }

    const reader = new FileReader(); 
    reader.onload = function (e) { updateFn(e.target.result, file.name); }; 
    reader.readAsDataURL(file);
};

window.cancelExistingRegistration = function () {
    window.form.existingRegistrationType = '';
    window.form.existingRegistrationNo = '';
    window.form.existingRegistrationDate = '';
    renderContent();
};

window.selectHSN = function (el) {
    const code = el.getAttribute('data-code');
    if (!Array.isArray(window.form.goods_hsn)) window.form.goods_hsn = [];
    if (window.form.goods_hsn.length >= 5) {
        alert("Maximum 5 items allowed.");
        return;
    }
    if (!window.form.goods_hsn.includes(code)) {
        window.form.goods_hsn.push(code);
    }
    document.getElementById('hsn-search-input').value = '';
    document.getElementById('hsn-dropdown').style.display = 'none';
    renderContent();
};

window.selectSAC = function (el) {
    const code = el.getAttribute('data-code');
    if (!Array.isArray(window.form.goods_sac)) window.form.goods_sac = [];
    if (window.form.goods_sac.length >= 5) {
        alert("Maximum 5 items allowed.");
        return;
    }
    if (!window.form.goods_sac.includes(code)) {
        window.form.goods_sac.push(code);
    }
    document.getElementById('sac-search-input').value = '';
    document.getElementById('sac-dropdown').style.display = 'none';
    renderContent();
};

let hsnTimeout;
window.searchHSN = function (query) {
    const dropdown = document.getElementById('hsn-dropdown');

    if (query.length < 2) {
        if (dropdown) dropdown.style.display = 'none';
        return;
    }

    clearTimeout(hsnTimeout);
    hsnTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`https://reg.gst.gov.in/master/hsn/l1/${encodeURIComponent(query)}`);
            const json = await response.json();
            const data = json.data || [];

            if (data.length === 0) {
                dropdown.innerHTML = '<div style="padding: 8px 12px; color: #64748b;">No results found</div>';
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = data.map(item => {
                const codeAttr = item.c.replace(/"/g, '&quot;');
                const nameAttr = item.n.replace(/"/g, '&quot;');
                return `
                <div style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e2e8f0; font-size: 13px;" 
                     onmouseover="this.style.backgroundColor='#f1f5f9'" onmouseout="this.style.backgroundColor='transparent'"
                     data-code="${codeAttr}" data-name="${nameAttr}"
                     onmousedown="window.selectHSN(this)">
                    <strong style="color: #0f172a;">${item.c}</strong> - <span style="color: #475569;">${item.n}</span>
                </div>
            `}).join('');
            dropdown.style.display = 'block';
        } catch (e) {
            dropdown.innerHTML = '<div style="padding: 8px 12px; color: #ef4444;">Error fetching data</div>';
            dropdown.style.display = 'block';
        }
    }, 400);
};

let sacTimeout;
window.searchSAC = function (query) {
    const dropdown = document.getElementById('sac-dropdown');

    if (query.length < 2) {
        if (dropdown) dropdown.style.display = 'none';
        return;
    }

    clearTimeout(sacTimeout);
    sacTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`https://reg.gst.gov.in/master/sac/${encodeURIComponent(query)}`);
            const json = await response.json();
            const data = json.data || [];

            if (data.length === 0) {
                dropdown.innerHTML = '<div style="padding: 8px 12px; color: #64748b;">No results found</div>';
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = data.map(item => {
                const codeAttr = item.c.replace(/"/g, '&quot;');
                const nameAttr = item.n.replace(/"/g, '&quot;');
                return `
                <div style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #e2e8f0; font-size: 13px;" 
                     onmouseover="this.style.backgroundColor='#f1f5f9'" onmouseout="this.style.backgroundColor='transparent'"
                     data-code="${codeAttr}" data-name="${nameAttr}"
                     onmousedown="window.selectSAC(this)">
                    <strong style="color: #0f172a;">${item.c}</strong> - <span style="color: #475569;">${item.n}</span>
                </div>
            `}).join('');
            dropdown.style.display = 'block';
        } catch (e) {
            dropdown.innerHTML = '<div style="padding: 8px 12px; color: #ef4444;">Error fetching data</div>';
            dropdown.style.display = 'block';
        }
    }, 400);
};

document.addEventListener('click', (e) => {
    const hsnDropdown = document.getElementById('hsn-dropdown');
    if (hsnDropdown && !e.target.closest('#hsn-dropdown') && !e.target.closest('input[placeholder="Search HSN Chapter"]')) {
        hsnDropdown.style.display = 'none';
    }
    const sacDropdown = document.getElementById('sac-dropdown');
    if (sacDropdown && !e.target.closest('#sac-dropdown') && !e.target.closest('input[placeholder="Search Service Classification Code"]')) {
        sacDropdown.style.display = 'none';
    }
});

window.navigateTo = function(path) {
    history.pushState(null, '', path);
    handleRoute();
};

window.handleRoute = function() {
    const path = window.location.pathname;
    
    document.getElementById('user-wizard-container').classList.add('hidden');
    document.getElementById('admin-dashboard-container').classList.add('hidden');
    document.getElementById('automation-platform-container').classList.add('hidden');
    
    const header = document.querySelector('header.top');
    
    if (path === '/admin') {
        if (!isAdmin) {
            document.getElementById('user-wizard-container').classList.remove('hidden');
            if (header) header.classList.remove('hidden');
            window.openAdminLogin();
        } else {
            document.getElementById('admin-dashboard-container').classList.remove('hidden');
            if (header) header.classList.add('hidden');
            renderAdminDashboard();
        }
    } else if (path === '/automation') {
        document.getElementById('automation-platform-container').classList.remove('hidden');
        if (header) header.classList.add('hidden');
    } else {
        document.getElementById('user-wizard-container').classList.remove('hidden');
        if (header) {
            if (typeof step !== 'undefined' && step === 0 && typeof isPreview !== 'undefined' && !isPreview) {
                 header.classList.remove('hidden');
            } else {
                 header.classList.add('hidden');
            }
        }
        if (typeof renderContent === 'function') renderContent();
    }
};

window.addEventListener('popstate', handleRoute);
document.addEventListener('DOMContentLoaded', () => {
    handleRoute();
});




