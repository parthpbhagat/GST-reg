/**
 * GST Application Payload Builder
 * Compiles application data from the local database into the exact official JSON structure
 * expected by reg.gst.gov.in:
 * - /registration/auth/api/applicationdata?applnId={draftId}
 * - /registration/auth/api/verify/generateFinalformJsonWithApoB?amendFlag=APLRG&draftId={draftId}
 */

const STATE_CODES = {
    'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
    'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08',
    'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12',
    'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16',
    'meghalaya': '17', 'assam': '18', 'west bengal': '19', 'jharkhand': '20',
    'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
    'daman and diu': '25', 'dadra and nagar haveli': '26', 'maharashtra': '27',
    'andhra pradesh': '28', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31',
    'kerala': '32', 'tamil nadu': '33', 'puducherry': '34', 'andaman and nicobar islands': '35',
    'telangana': '36', 'andhra pradesh (new)': '37', 'ladakh': '38'
};

function getStateCode(stateName) {
    if (!stateName) return '24';
    const clean = stateName.toLowerCase().trim();
    return STATE_CODES[clean] || '24';
}

function getConstitutionCode(constName) {
    if (!constName) return 'PRO';
    const c = constName.toLowerCase();
    if (c.includes('proprietor')) return 'PRO';
    if (c.includes('private limited') || c.includes('pvt')) return 'PVT';
    if (c.includes('public limited')) return 'PUB';
    if (c.includes('limited liability') || c.includes('llp')) return 'LLP';
    if (c.includes('partnership')) return 'PAR';
    if (c.includes('huf') || c.includes('hindu undivided')) return 'HUF';
    if (c.includes('society') || c.includes('club')) return 'SOC';
    if (c.includes('trust')) return 'TRU';
    return 'PRO';
}

function getPossessionCode(possessionName) {
    if (!possessionName) return 'CON';
    const p = possessionName.toLowerCase();
    if (p.includes('consent')) return 'CON';
    if (p.includes('rent')) return 'REN';
    if (p.includes('own')) return 'OWN';
    if (p.includes('lease')) return 'LEA';
    if (p.includes('share')) return 'SHR';
    return 'CON';
}

function formatDDMMYYYY(dateStr) {
    if (!dateStr) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return `${d}/${m}/${y}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    }
    return dateStr;
}

/**
 * Builds the official GST registration payload
 * @param {Object} data - Application data from Supabase/wizard
 * @param {string} draftId - Portal draft ID (e.g. 75028658)
 * @param {string} trn - Temporary Reference Number (e.g. 242600300674TRN)
 * @returns {Object} JSON payload matching reg.gst.gov.in schema
 */
function buildGstApplicationPayload(data, draftId = '75028658', trn = '') {
    data = data || {};
    const stateCd = getStateCode(data.state || data.ppob_state);
    const cleanPan = (data.pan || '').toUpperCase().trim();
    const cleanLegalName = (data.legalName || '').trim();
    const cleanEmail = (data.email || data.ppob_email || '').toLowerCase().trim();
    const cleanMobile = (data.mobile || data.ppob_mobile || '').trim();
    const constitutionCode = getConstitutionCode(data.businessConstitution);
    const commencementDate = formatDDMMYYYY(data.dateOfCommencement);

    // Build Promoters array (opdtls)
    const opdtls = [];
    for (let i = 1; i <= 10; i++) {
        const p = data['p' + i];
        if (p && (p.firstName || p.lastName)) {
            opdtls.push({
                eid: i,
                fn: (p.firstName || '').trim(),
                mn: (p.middleName || '').trim(),
                ln: (p.lastName || '').trim(),
                fhfn: (p.fatherFirstName || '').trim(),
                fhmn: (p.fatherMiddleName || '').trim(),
                fhln: (p.fatherLastName || '').trim(),
                dob: formatDDMMYYYY(p.dob),
                gd: (p.gender || 'male').toLowerCase().startsWith('f') ? 'F' : 'M',
                mbno: (p.mobile || cleanMobile).trim(),
                em: (p.email || cleanEmail).toLowerCase().trim(),
                dg: (p.designation || 'director').toLowerCase().trim(),
                pan: { num: (p.pan || cleanPan).toUpperCase().trim() },
                rsad: {
                    cnty: 'IND',
                    stcd: getStateCode(p.res_state || data.state),
                    dst: (p.res_district || data.district || '').trim(),
                    loc: (p.res_city || p.res_locality || '').trim(),
                    pncd: (p.res_pincode || data.ppob_pincode || '').trim(),
                    bno: (p.res_buildingNo || p.res_floor || '').trim(),
                    bnm: (p.res_buildingName || '').trim(),
                    st: (p.res_road || p.res_locality || '').trim()
                },
                dcupdtls: p.promoterPhotoFile ? [{
                    id: 180968957 + i,
                    ty: 'PHOT',
                    ct: 'image/jpeg',
                    hash: '2b078bba165fb00d63b09afd4c699d5314beb53ae6beb789fffb258ab753f34b'
                }] : [],
                iscitind: 'Y',
                isopcmpt: 'Y',
                isNewSignatoryDetailsAfterSCN: false
            });
        }
    }

    if (opdtls.length === 0) {
        opdtls.push({
            eid: 1,
            fn: cleanLegalName.split(' ')[0] || 'Applicant',
            mn: cleanLegalName.split(' ')[1] || '',
            ln: cleanLegalName.split(' ').slice(2).join(' ') || '',
            fhfn: 'Father',
            fhmn: '',
            fhln: '',
            dob: '23/02/1993',
            gd: 'M',
            mbno: cleanMobile,
            em: cleanEmail,
            dg: 'director',
            pan: { num: cleanPan },
            rsad: {
                cnty: 'IND',
                stcd: stateCd,
                dst: data.district || 'Ahmedabad',
                loc: data.ppob_city || 'Ahmedabad',
                pncd: data.ppob_pincode || '380004',
                bno: data.ppob_flatNo || '',
                bnm: data.ppob_building || '',
                st: data.ppob_street || ''
            },
            dcupdtls: [],
            iscitind: 'Y',
            isopcmpt: 'Y',
            isNewSignatoryDetailsAfterSCN: false
        });
    }

    // Build Authorized Signatories array (asgdtls)
    const asgdtls = [];
    for (let i = 1; i <= 10; i++) {
        const a = data['a' + i];
        if (a && (a.firstName || a.lastName)) {
            asgdtls.push({
                eid: i + 1,
                fn: (a.firstName || '').trim(),
                mn: (a.middleName || '').trim(),
                ln: (a.lastName || '').trim(),
                fhfn: (a.fatherFirstName || '').trim(),
                fhmn: (a.fatherMiddleName || '').trim(),
                fhln: (a.fatherLastName || '').trim(),
                dob: formatDDMMYYYY(a.dob),
                gd: (a.gender || 'male').toLowerCase().startsWith('f') ? 'F' : 'M',
                mbno: (a.mobile || cleanMobile).trim(),
                em: (a.email || cleanEmail).toLowerCase().trim(),
                dg: (a.designation || 'director').toLowerCase().trim(),
                pan: { num: (a.pan || cleanPan).toUpperCase().trim() },
                rsad: {
                    cnty: 'IND',
                    stcd: getStateCode(a.res_state || data.state),
                    dst: (a.res_district || data.district || '').trim(),
                    loc: (a.res_city || a.res_locality || '').trim(),
                    pncd: (a.res_pincode || data.ppob_pincode || '').trim(),
                    bno: (a.res_buildingNo || a.res_floor || '').trim(),
                    bnm: (a.res_buildingName || '').trim(),
                    st: (a.res_road || a.res_locality || '').trim()
                },
                dcupdtls: a.authSigPhotoFile ? [{
                    id: 180968957 + i,
                    ty: 'PHOT',
                    ct: 'image/jpeg',
                    hash: '2b078bba165fb00d63b09afd4c699d5314beb53ae6beb789fffb258ab753f34b'
                }] : [],
                iscitind: 'Y',
                isasg: 'Y',
                isasgcmpt: 'Y',
                ispas: 'Y',
                aadhaarflag: 'Y',
                isNewSignatoryDetailsAfterSCN: false
            });
        }
    }

    if (asgdtls.length === 0) {
        const firstOp = opdtls[0];
        asgdtls.push(Object.assign({}, firstOp, {
            eid: 2,
            isasg: 'Y',
            isasgcmpt: 'Y',
            ispas: 'Y',
            aadhaarflag: 'Y'
        }));
    }

    // Goods & Services (gdssvcdtls)
    const bzgddtls = [];
    if (data.goods_hsn && Array.isArray(data.goods_hsn)) {
        data.goods_hsn.forEach((g, idx) => {
            bzgddtls.push({
                eid: idx + 1,
                hsncd: String(g.hsn || g.code || g.hsncd || g).trim(),
                gdes: String(g.description || g.desc || g.gdes || 'GOODS').trim()
            });
        });
    }
    if (bzgddtls.length === 0) {
        bzgddtls.push({ eid: 1, hsncd: '1001', gdes: 'WHEAT AND MESLIN' });
    }

    const bzsdtls = [];
    if (data.goods_sac && Array.isArray(data.goods_sac)) {
        data.goods_sac.forEach((s, idx) => {
            bzsdtls.push({
                eid: idx + 1,
                saccd: String(s.sac || s.code || s.saccd || s).trim(),
                sdes: String(s.description || s.desc || s.sdes || 'SERVICES').trim()
            });
        });
    }

    // PPOB Nature of Business array
    const ntbz = [];
    if (data.ppob_natureOfBusiness && typeof data.ppob_natureOfBusiness === 'object') {
        const nob = data.ppob_natureOfBusiness;
        if (nob.warehouseDepot || nob.bondedWarehouse) ntbz.push('BWH');
        if (nob.retailBusiness) ntbz.push('RTL');
        if (nob.wholesaleBusiness) ntbz.push('WHL');
        if (nob.factoryManufacturing) ntbz.push('MFG');
        if (nob.officeSaleOffice) ntbz.push('OFC');
        if (nob.export) ntbz.push('EXP');
        if (nob.import) ntbz.push('IMP');
        if (nob.worksContract) ntbz.push('WKC');
    }
    if (ntbz.length === 0) ntbz.push('BWH');

    // Assemble the complete official JSON object
    const finalPayload = {
        aplCd: String(draftId || '75028658'),
        rgdtls: {
            aplst: 'DFT',
            aplty: 'APLRG',
            duedt: formatDDMMYYYY(data.dateOfLiability || new Date(Date.now() + 15 * 86400000)),
            moddt: formatDDMMYYYY(new Date()),
            mbno: cleanMobile,
            em: cleanEmail
        },
        bzdtls: {
            bzdtlsbz: {
                cobz: constitutionCode,
                rslibrg: data.reasonToObtainRegistration || 'VOLN',
                lgnmbzpan: cleanLegalName,
                pan: {
                    num: cleanPan,
                    iv: 'V',
                    panDate: commencementDate
                },
                stcd: stateCd,
                addltrdnms: data.tradeName ? [{ trdnm: data.tradeName }] : [],
                isopcmp: 'N',
                cmbzdt: commencementDate,
                iscasdl: 'N',
                otherRsLib: '',
                dst: data.district || data.businessDistrict || 'GJAHM',
                sezDtls: {},
                regCategory: [],
                optCat: 'Y',
                optCatDeclStatus: 'Y'
            },
            exrgdtls: []
        },
        decdtls: {
            dt: formatDDMMYYYY(new Date()),
            place: (data.verification_place || data.ppob_city || data.district || 'Ahmedabad').trim()
        },
        secToken: trn || data.trn || `${stateCd}2600${draftId}TRN`,
        map: {
            adbzdtls: [],
            opdtls: [{
                eid: 1,
                lt: String(data.ppob_latitude || '23.050015'),
                lg: String(data.ppob_longitude || '72.583656'),
                eloc: data.ppob_pincode || '380004',
                city: data.ppob_city || data.district || 'Ahmedabad',
                geoCodeLevel: 'pincode',
                nrbyLdMrk: data.ppob_landmark || null,
                locSubloc: null,
                feedback: { locSubloc: false, st: false, bnm: false, bno: false, nrbyLdMrk: false }
            }],
            asgdtls: [{
                eid: 2,
                lt: String(data.ppob_latitude || '23.050015'),
                lg: String(data.ppob_longitude || '72.583656'),
                eloc: data.ppob_pincode || '380004',
                city: data.ppob_city || data.district || 'Ahmedabad',
                geoCodeLevel: 'pincode',
                nrbyLdMrk: data.ppob_landmark || null,
                locSubloc: null,
                feedback: { locSubloc: false, st: false, bnm: false, bno: false, nrbyLdMrk: false }
            }],
            ppbzdtls: {
                lt: String(data.ppob_latitude || '23.050015'),
                lg: String(data.ppob_longitude || '72.583656'),
                eloc: data.ppob_pincode || '380004',
                city: data.ppob_city || data.district || 'Ahmedabad',
                geoCodeLevel: 'pincode',
                nrbyLdMrk: data.ppob_landmark || null,
                locSubloc: null,
                feedback: { locSubloc: false, st: false, bnm: false, bno: false, nrbyLdMrk: false }
            }
        },
        sezPovToDateVald: '10',
        jurdFlag: 'Y',
        isAddlnInfo: 'Y',
        isMsrChildFlow: 'N',
        msrActiveTab: 'BKACDTLS',
        itcPassonLimit: '250000',
        asgdtls: asgdtls,
        opdtls: opdtls,
        validateMultiReg: 'N',
        gdssvcdtls: {
            bzgddtls: bzgddtls,
            bzsdtls: bzsdtls
        },
        stsidtls: {
            ebdtls: {
                hasebconn: data.stateSpecific_electricityBoard ? 'Y' : 'N',
                ebdes: data.stateSpecific_electricityBoard || 'Torrent Power Limited',
                ebcd: 'TPA',
                canum: data.stateSpecific_electricityConsumerNo || '12345678901'
            }
        },
        adhrflag: (data.aadhaarAuth || 'Yes').toLowerCase() === 'no' ? 'N' : 'Y',
        ppbzdtls: {
            add: {
                stcd: stateCd,
                pncd: data.ppob_pincode || '380004',
                dst: data.ppob_district || data.district || 'GJAHM',
                loc: data.ppob_city || data.ppob_locality || 'Ahmedabad',
                lg: String(data.ppob_longitude || '72.583656'),
                lt: String(data.ppob_latitude || '23.050015'),
                st: data.ppob_street || data.ppob_locality || 'Main Road',
                bno: data.ppob_flatNo || data.ppob_building || 'Shop No 1'
            },
            ntbz: ntbz,
            contdtls: {
                em: cleanEmail,
                mbno: cleanMobile
            },
            hasaddl: 'N',
            cj: {
                comrtcd: data.ppob_commissionerate || 'WT',
                divsncd: data.ppob_division || 'WT01',
                rangecd: data.ppob_range || 'WT0104'
            },
            sj: {
                stjdno: data.ppob_stateJurisdiction || 'GJ013',
                stjd: 'unit'
            },
            psnt: getPossessionCode(data.ppob_natureOfPossession),
            dcupdtls: [{
                id: '20261024134747',
                ty: 'ELCB',
                ct: 'application/pdf',
                docName: data.ppob_docFileName || 'electricity_bill.pdf',
                hash: '097a854004509d1a70983b91ca9e6dfabf51b835d40b72e0e818b97ec372e5d8',
                legibscore: '84.55'
            }]
        },
        adbzdtls: []
    };

    return finalPayload;
}

module.exports = {
    buildGstApplicationPayload,
    getStateCode,
    getConstitutionCode,
    formatDDMMYYYY
};
