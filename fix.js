const fs = require('fs');
let code = fs.readFileSync('frontend/public/script.js', 'utf8');

const search = '    if (app) {\r\n        form = JSON.parse(JSON.stringify(app.data));\r\n        form._appId = app.appId;';

const replacement = `    if (app) {
        const defaultForm = {
            goods_hsn: [], goods_sac: [],
            taxpayerType: '', legalName: '', tradeName: '', pan: '', email: '', mobile: '', state: '', district: '',
            businessConstitution: '', dateOfCommencement: '', dateOfLiability: '', reasonToObtainRegistration: '', businessDistrict: '',
            rule14A: '',
            existingRegistrationType: '', existingRegistrationNo: '', existingRegistrationDate: '',
            proofOfConstitutionType: '', proofOfConstitutionFile: '', documentForTradeNameFile: '',
            ppob_building: '', ppob_flatNo: '', ppob_floor: '', ppob_street: '', ppob_locality: '', ppob_city: '',
            ppob_state: '', ppob_district: '', ppob_pincode: '', ppob_country: 'India', ppob_landmark: '', ppob_latitude: '', ppob_longitude: '',
            ppob_stateJurisdiction: '', ppob_commissionerate: '', ppob_division: '', ppob_range: '',
            ppob_email: '', ppob_stdCode: '', ppob_telephone: '', ppob_mobile: '', ppob_faxStdCode: '', ppob_fax: '',
            ppob_natureOfPossession: '', ppob_doc: '', ppob_docFile: '',
            ppob_natureOfBusiness: { bondedWarehouse: false, factoryManufacturing: false, leasingBusiness: false, retailBusiness: false, worksContract: false, eouStpEhtp: false, import: false, officeSaleOffice: false, warehouseDepot: false, others: false, export: false, supplierOfServices: false, recipientOfGoodsOrServices: false, wholesaleBusiness: false },
            p1: JSON.parse(JSON.stringify(window.defaultPromoter)),
            a1: JSON.parse(JSON.stringify(window.defaultAuthSig)),
            stateSpecific_electricityBoard: '', stateSpecific_electricityConsumerNo: '',
            stateSpecific_ptEcNo: '', stateSpecific_ptRcNo: '',
            stateSpecific_exciseLicenseNo: '', stateSpecific_exciseLicenseHolder: ''
        };
        const loadedData = JSON.parse(JSON.stringify(app.data));
        window.form = Object.assign({}, defaultForm, loadedData);
        window.form.p1 = Object.assign({}, defaultForm.p1, loadedData.p1 || {});
        window.form.a1 = Object.assign({}, defaultForm.a1, loadedData.a1 || {});
        window.form.ppob_natureOfBusiness = Object.assign({}, defaultForm.ppob_natureOfBusiness, loadedData.ppob_natureOfBusiness || {});
        window.form.goods_hsn = loadedData.goods_hsn || [];
        window.form.goods_sac = loadedData.goods_sac || [];
        window.form._appId = app.appId;`.split('\n').join('\r\n');

if (code.includes(search)) {
    code = code.replace(search, replacement);
    fs.writeFileSync('frontend/public/script.js', code);
    console.log('Replaced successfully');
} else {
    const search2 = search.replace(/\r\n/g, '\n');
    if (code.includes(search2)) {
        code = code.replace(search2, replacement.replace(/\r\n/g, '\n'));
        fs.writeFileSync('frontend/public/script.js', code);
        console.log('Replaced successfully (LF)');
    } else {
        console.log('Search string not found');
    }
}
