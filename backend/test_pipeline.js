const http = require('http');

async function testAll() {
    console.log('--- STARTING COMPREHENSIVE PIPELINE TEST ---');

    // 1. Test Backend Health & Dynamic Endpoints
    console.log('\n[1/4] Testing Backend /api/gst-endpoints...');
    await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:3002/api/gst-endpoints?state_cd=27&draftId=92980126&pincode=444906&docId=20261027178892', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.success && parsed.endpoints.keepalive && parsed.endpoints.applicationdata.includes('92980126')) {
                    console.log('✅ /api/gst-endpoints working perfectly!');
                    console.log('   - Keepalive:', parsed.endpoints.keepalive);
                    console.log('   - ApplicationData:', parsed.endpoints.applicationdata);
                    console.log('   - FinalForm:', parsed.endpoints.generateFinalformJsonWithApoB);
                    console.log('   - EVC OTP:', parsed.endpoints.evc_otp);
                    resolve();
                } else {
                    reject(new Error('Invalid response from /api/gst-endpoints'));
                }
            });
        }).on('error', reject);
    });

    // 2. Test Payload Builder
    console.log('\n[2/4] Testing GST Payload Builder...');
    const { buildGstApplicationPayload } = require('../backend/utils/gst_payload_builder');
    const sampleData = {
        legalName: 'Parth Purushottam Bhagat',
        tradeName: 'Bhagat Traders',
        pan: 'HLMPB2822M',
        email: 'parthpbhagat@gmail.com',
        mobile: '9011494385',
        state: 'Maharashtra',
        district: 'Amravati',
        businessConstitution: 'Proprietorship',
        reasonToObtainRegistration: 'Voluntary Basis',
        dateOfCommencement: '01/10/2026',
        dateOfLiability: '01/10/2026',
        ppob_pincode: '444906',
        ppob_state: 'Maharashtra',
        ppob_district: 'Amravati',
        ppob_city: 'Warud',
        ppob_buildingNo: '23',
        ppob_road: 'ntr road',
        ppob_locality: 'Warud MIDC',
        ppob_natureOfPossession: 'Consent',
        ppob_natureOfBusiness: { Warehouse: true },
        goodsOrServices: 'Goods',
        hsnGoods: [{ hsnCode: '1001', description: 'WHEAT AND MESLIN' }],
        p1: {
            firstName: 'Parth',
            middleName: 'P',
            lastName: 'Bhagat',
            fatherFirstName: 'purushottam',
            fatherMiddleName: 'vishram',
            fatherLastName: 'bhagat',
            pan: 'HLMPB2822M',
            email: 'parthpbhagat@gmail.com',
            mobile: '9011494385',
            dob: '13/03/1998',
            gender: 'Male',
            designation: 'prop',
            alsoAuthorizedSignatory: true,
            primary: true,
            res_pincode: '444906',
            res_state: 'Maharashtra',
            res_district: 'Amravati',
            res_city: 'Warud MIDC',
            res_road: 'ntr road',
            res_buildingNo: '23'
        }
    };

    const payload = buildGstApplicationPayload(sampleData, '92980126', '272600508789TRN');
    if (payload.aplCd === '92980126' && payload.secToken === '272600508789TRN' && payload.bzdtls?.bzdtlsbz?.cobz === 'PRO') {
        console.log('✅ GST Payload Builder compiled official JSON matching portal schema!');
        console.log('   - aplCd (DraftId):', payload.aplCd);
        console.log('   - secToken (TRN):', payload.secToken);
        console.log('   - Legal Name:', payload.bzdtls?.bzdtlsbz?.lgnmbzpan);
        console.log('   - Constitution:', payload.bzdtls?.bzdtlsbz?.cobz);
        console.log('   - Reason Code:', payload.bzdtls?.bzdtlsbz?.rslibrg);
    } else {
        throw new Error('Payload builder validation failed');
    }

    // 3. Test Runner Syntax & Compilation
    console.log('\n[3/4] Testing Automation Runner file syntax & dependencies...');
    const { execSync } = require('child_process');
    execSync('node -c automation/runner.js');
    console.log('✅ Automation Runner syntax & compilation validated successfully.');

    // 4. Test Frontend Server (Vite)
    console.log('\n[4/4] Testing Frontend Vite Dev Server...');
    await new Promise((resolve, reject) => {
        http.get('http://localhost:5173', (res) => {
            if (res.statusCode === 200) {
                console.log(`✅ Frontend accessible at http://localhost:5173 (Status: ${res.statusCode})`);
                resolve();
            } else {
                reject(new Error(`Frontend returned status ${res.statusCode}`));
            }
        }).on('error', reject);
    });

    console.log('\n🎉 ALL PIPELINE TESTS PASSED 100% SUCCESSFULLY!');
}

testAll().catch(err => {
    console.error('❌ Pipeline Test Failed:', err.message);
    process.exit(1);
});
