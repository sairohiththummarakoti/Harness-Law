import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportPatch, suggestImportFields, validateImportValue, type ImportField } from '../lib/form-import.ts';
import { applyIntakeImportPatch, intakeImportFields, PROFILE_IMPORT_FIELDS, PROFESSIONAL_IMPORT_FIELDS, WORKSHEET_IMPORT_FIELDS, DRAFT_IMPORT_FIELDS, factImportFields } from '../lib/form-import-fields.ts';
import { applyAction, createEmptyCase, createSampleCase } from '../lib/model.ts';
import { applyIntakeStep, intakeAnswersFromCase } from '../lib/intake.ts';
import { caseSchema } from '../lib/validation.ts';
import { parseImportDocument } from '../lib/form-import-parse.ts';
import { makeDocx } from './form-import-fixtures.ts';

test('labeled contact fields offer typed suggestions, preserving nonempty answers by default', () => {
  const suggestions = suggestImportFields('Full name: Jordan Rivera\nPhone: +1 202 555 0108\nCountry of residence: USA\nEmail: jordan@example.test', PROFILE_IMPORT_FIELDS, { fullName: 'Existing Applicant', phone: '', country: '' });
  assert.deepEqual(suggestions.map(({key,value,selected}) => ({key,value,selected})), [
    { key: 'fullName', value: 'Jordan Rivera', selected: false }, { key: 'email', value: 'jordan@example.test', selected: true },
    { key: 'phone', value: '+1 202 555 0108', selected: true }, { key: 'country', value: 'United States', selected: true },
  ]);
  assert.match(suggestions[0].excerpt, /Full name: Jordan/);
  const {patch} = buildImportPatch(PROFILE_IMPORT_FIELDS, suggestions, {fullName:'Existing Applicant'});
  assert.equal(patch.fullName, undefined);
  assert.equal(patch.phone, '+1 202 555 0108');
});

test('clear resume header, contact line and experience section are usable without inventing facts', () => {
  const resume = 'Jordan Rivera\nCurriculum Vitae\njordan@example.test\n+1 (202) 555-0108\n\nWork experience\n2022–present · Research Scientist, Example Institute\n2018–2022 · Research Fellow\n\nEducation\nPhD in Computer Science';
  const personal = suggestImportFields(resume, PROFILE_IMPORT_FIELDS, {});
  assert.equal(personal.find(item=>item.key==='fullName')?.value, 'Jordan Rivera');
  assert.equal(personal.find(item=>item.key==='email')?.value, 'jordan@example.test');
  assert.equal(personal.find(item=>item.key==='phone')?.value, '+1 (202) 555-0108');
  const professional = suggestImportFields(resume, PROFESSIONAL_IMPORT_FIELDS, {});
  assert.equal(professional.length, 1);
  assert.equal(professional[0].key, 'timeline');
  assert.match(String(professional[0].value), /Research Fellow/);
  assert.doesNotMatch(String(professional[0].value), /PhD/);
  assert.deepEqual(suggestImportFields('Jordan Rivera is a leading researcher whose achievements demonstrate extraordinary ability.', intakeImportFields('criteria'), {}), []);
  const compact = suggestImportFields('Jordan Rivera\njordan@example.test | +1 202 555 0108\nProfessional experience', PROFILE_IMPORT_FIELDS, {});
  assert.equal(compact.find(item=>item.key==='fullName')?.value,'Jordan Rivera');
  assert.equal(compact.find(item=>item.key==='fullName')?.selected,false,'an unlabeled header name needs explicit selection');
  assert.equal(compact.find(item=>item.key==='phone')?.value,'+1 202 555 0108');
  assert.equal(suggestImportFields('Principal Scientist\ncontact@example.test', PROFILE_IMPORT_FIELDS, {}).some(item=>item.key==='fullName'),false);
});

test('contradictory repeated fields and unstructured prose remain manual', () => {
  assert.deepEqual(suggestImportFields('Full name: Jordan Rivera\nFull name: Alex Chen', PROFILE_IMPORT_FIELDS, {}), []);
  assert.deepEqual(suggestImportFields('Full name: null\nPhone: N/A', PROFILE_IMPORT_FIELDS, {}), []);
  assert.deepEqual(suggestImportFields('I have worked in research for years, and want to continue my work.', PROFESSIONAL_IMPORT_FIELDS, {}), []);
  assert.deepEqual(suggestImportFields('Awards\nResearch prize 2025', intakeImportFields('criteria'), {}), []);
  assert.equal(suggestImportFields('Resume\nWork Experience\n2022-present: Research Scientist', PROFILE_IMPORT_FIELDS, {}).some(item=>item.key==='fullName'), false);
  assert.equal(suggestImportFields('Address: 42 Example Road\nToronto\nCanada', PROFILE_IMPORT_FIELDS, {})[0].value, '42 Example Road\nToronto\nCanada');
  assert.equal(suggestImportFields('Experience\nResearch Scientist\nNorthstar Institute\n2022-present: Led a research team\nEducation\nPhD', PROFESSIONAL_IMPORT_FIELDS, {})[0].value, 'Research Scientist\nNorthstar Institute\n2022-present: Led a research team');
});

test('explicit applicant visa/country/criteria answers normalize against current catalogs', () => {
  assert.equal(suggestImportFields('Visa interest: EB-2 NIW', intakeImportFields('visa'), {})[0].value, 'eb2niw');
  assert.equal(suggestImportFields('Country of birth: United Kingdom', intakeImportFields('birth'), {})[0].value, 'GB');
  assert.deepEqual(suggestImportFields('Citizenships: Canada; US', intakeImportFields('citizenships'), {})[0].value, ['CA','US']);
  assert.deepEqual(suggestImportFields('Selected criteria: C04; Scholarly authorship', intakeImportFields('criteria'), {})[0].value, ['C04','C06']);
  assert.equal(suggestImportFields('Major international award: No', intakeImportFields('criteria'), {})[0].value, 'no');
  const unsure = suggestImportFields('Criteria unsure: yes', intakeImportFields('criteria'), {criteriaUnsure:false})[0];
  assert.equal(unsure.value, true);
  assert.equal(unsure.selected, false, 'a boolean false is an existing answer');
});

test('ambiguous extraction stays manual and third-party reference contacts never fill applicant details', () => {
  const mixed = 'Name: Alex Applicant\nEmail: pat.referee@example.test';
  assert.deepEqual(suggestImportFields(mixed, PROFILE_IMPORT_FIELDS, {}, {manualOnly:true}), []);
  for (const heading of ['References', '## References', '**Professional references:**', 'References: supplied below']) {
    const suggestions = suggestImportFields(`Full name: Alex Applicant\n${heading}\nName: Pat Referee\nEmail: pat.referee@example.test\n+1 202 555 0199`, PROFILE_IMPORT_FIELDS, {});
    assert.deepEqual(suggestions.map(({key,value})=>({key,value})), [{key:'fullName',value:'Alex Applicant'}], heading);
  }
  assert.deepEqual(suggestImportFields('References\nName: Pat Referee\nEmail: pat@example.test', PROFILE_IMPORT_FIELDS, {}), []);
  assert.deepEqual(suggestImportFields('Referee email: pat@example.test\nNotes: Contact a.referee@example.test for details.', PROFILE_IMPORT_FIELDS, {}), []);
  const applicantAgain = suggestImportFields('References\nName: Pat Referee\nEmail: pat@example.test\nApplicant details\nFull name: Alex Applicant\nEmail: alex@example.test', PROFILE_IMPORT_FIELDS, {});
  assert.equal(applicantAgain.find(item=>item.key==='fullName')?.value,'Alex Applicant');
  assert.equal(applicantAgain.find(item=>item.key==='email')?.value,'alex@example.test');
  assert.deepEqual(suggestImportFields('Experience\n2018-2022\ncontact@example.test', PROFILE_IMPORT_FIELDS, {}), [], 'header heuristics stop before the resume body');
});

test('structured records cannot combine applicants or inject independent fields through scalar newlines', () => {
  const cases = [
    ['a.json', JSON.stringify([{fullName:'Alex Applicant'},{email:'pat.referee@example.test'}])],
    ['a.json', JSON.stringify({fullName:'Alex Applicant',notes:'First contact\nFull name: Pat Referee'})],
    ['a.json', JSON.stringify({applicant:{fullName:'Alex Applicant'},reference:{email:'pat.referee@example.test'}})],
    ['a.csv', 'fullName,email\nAlex Applicant,\nPat Referee,pat.referee@example.test'],
  ];
  for (const [name, text] of cases) {
    const document = parseImportDocument(name, new TextEncoder().encode(text));
    assert.equal(document.manualOnly,true,name);
    assert.ok(document.manualOnlyReason);
    assert.deepEqual(suggestImportFields(document.text, PROFILE_IMPORT_FIELDS, {}, document), []);
  }
  const single = parseImportDocument('a.json', new TextEncoder().encode(JSON.stringify({fullName:'Alex Applicant',phone:'+1 202 555 0146'})));
  assert.equal(single.manualOnly,undefined);
  assert.equal(suggestImportFields(single.text,PROFILE_IMPORT_FIELDS,{},single).find(item=>item.key==='fullName')?.value,'Alex Applicant');
});

test('standalone date ranges and identifiers are not phone numbers', () => {
  for (const value of ['2018-2022','2018–2022','2026-11-24','11/24/2026','123456789012']) {
    assert.equal(suggestImportFields(`Alex Applicant\n${value}`, PROFILE_IMPORT_FIELDS, {}).some(item=>item.key==='phone'), false, value);
  }
  assert.equal(suggestImportFields('Alex Applicant\nalex@example.test | +1 202 555 0146', PROFILE_IMPORT_FIELDS, {}).find(item=>item.key==='phone')?.value,'+1 202 555 0146');
});

test('Markdown label emphasis and narrative colon lines preserve exact proposed text', () => {
  for (const label of ['**Full name:** Alex Applicant','**Full name**: Alex Applicant','- **Full name:** Alex Applicant','__Full name:__ Alex Applicant']) {
    assert.equal(suggestImportFields(label, PROFILE_IMPORT_FIELDS, {})[0]?.value,'Alex Applicant',label);
  }
  const narrative = 'Paragraph one\nResearch question: How do cells grow?\nParagraph three';
  assert.equal(suggestImportFields(`Statement: ${narrative}`, DRAFT_IMPORT_FIELDS, {})[0]?.value,narrative);
  const experience = 'Research Scientist\nResponsibilities: Led a research team\n2022-present: Designed studies';
  assert.equal(suggestImportFields(`Experience\n${experience}\nEducation\nPhD`, PROFESSIONAL_IMPORT_FIELDS, {})[0]?.value,experience);
});

test('all-form DOCX labels bound scoped text without importing unavailable fields', () => {
  const lines = [
    'Full legal name: Jordan Rivera', 'Preferred name: Jordan', 'Email address: jordan.rivera@example.com',
    'Phone number: +1 202 555 0146', 'Country of residence: United States',
    'Mailing address: 123 Example Avenue, Example City, NY 10001', 'Prior names: Jordan Example',
    'Professional field: Biomedical engineering', 'Current role: Research Scientist', 'Organization: Example Research Institute',
    'Country of birth: Canada', 'Citizenships: Canada, United States', 'Visa interest: EB-1A',
    'Immigration help for: Myself or my family',
    'Employment and research timeline: 2020–2024: Research Scientist, Example Research Institute.',
    '2024–present: Led an assistive-device study.',
    'Key accomplishments: Published ten peer-reviewed biomedical research papers.',
    'Intended work in the United States: Continue research on assistive medical devices.',
    'Additional notes: Fictional data created solely for interface testing.',
    'Statement: Paragraph one', 'Research question: How do cells grow?', 'Paragraph three',
    'Case name: Jordan preparation',
  ];
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(line=>`<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const extracted = parseImportDocument('all-form-applicant.docx',makeDocx(xml));
  assert.equal(extracted.manualOnly,undefined);
  const values = (fields:ImportField[]) => Object.fromEntries(suggestImportFields(extracted.text,fields,{},extracted).map(item=>[item.key,item.value]));
  assert.deepEqual(values(WORKSHEET_IMPORT_FIELDS), {
    fullName:'Jordan Rivera', country:'United States', address:'123 Example Avenue, Example City, NY 10001',
    intendedWork:'Continue research on assistive medical devices.',
  });
  const personal = values(PROFILE_IMPORT_FIELDS);
  assert.equal(personal.address,'123 Example Avenue, Example City, NY 10001');
  assert.equal(personal.priorNames,'Jordan Example');
  assert.equal(personal.field,undefined);
  const professional = values(PROFESSIONAL_IMPORT_FIELDS);
  assert.equal(professional.timeline,'2020–2024: Research Scientist, Example Research Institute.\n2024–present: Led an assistive-device study.');
  assert.equal(professional.intendedWork,'Continue research on assistive medical devices.');
  assert.equal(professional.notes,undefined);
  assert.deepEqual(values(DRAFT_IMPORT_FIELDS),{text:'Paragraph one\nResearch question: How do cells grow?\nParagraph three'});
  assert.deepEqual(values(factImportFields('Full legal name')),{value:'Jordan Rivera'});
  assert.deepEqual(values(intakeImportFields('review')),{notes:'Fictional data created solely for interface testing.'});
});

test('invalid enums, stateless conflicts, oversized strings and nontext types cannot apply', () => {
  const citizenship = intakeImportFields('citizenships')[0];
  assert.match(validateImportValue(citizenship, 'Atlantis').error!, /not an available choice/);
  assert.match(validateImportValue(citizenship, ['CA','STATELESS']).error!, /not both/);
  const visa = suggestImportFields('Visa: secret investor visa', intakeImportFields('visa'), {});
  assert.equal(visa[0].selected, false);
  assert.match(visa[0].error!, /not an available choice/);
  assert.match(validateImportValue(PROFILE_IMPORT_FIELDS[0], 'a'.repeat(501)).error!, /500/);
  assert.match(validateImportValue(PROFILE_IMPORT_FIELDS.find(field=>field.key==='email')!, 'not-an-email').error!, /email/);
  assert.ok(validateImportValue(PROFILE_IMPORT_FIELDS[0], {name:'Jordan'}).error);
  assert.ok(validateImportValue(PROFILE_IMPORT_FIELDS[0], 'Jordan\u0000Rivera').error);
});

test('patch building is atomic, selected-only and scoped to the currently visible form', () => {
  const fields = intakeImportFields('basics');
  const valid = {key:'fullName',value:'Jordan Rivera',excerpt:'Name: Jordan Rivera',selected:true};
  assert.deepEqual(buildImportPatch(fields,[valid,{key:'phone',value:'999',excerpt:'',selected:false}],{}).patch, {fullName:'Jordan Rivera'});
  const outside = buildImportPatch(fields,[valid,{key:'visaType',value:'eb1a',excerpt:'',selected:true}],{});
  assert.deepEqual(outside.patch, {});
  assert.ok(outside.errors.visaType);
  const forbidden:ImportField[] = [{key:'consent',label:'Consent',kind:'boolean'},{key:'confirmed',label:'Confirmed',kind:'boolean'},{key:'accountEmail',label:'Account email'}];
  assert.deepEqual(suggestImportFields('Consent: yes\nConfirmed: true\nAccount email: replaced@example.test',forbidden,{}), []);
  assert.deepEqual(suggestImportFields('Email: replaced@example.test', fields, {}), [], 'account email is absent from every intake schema');
});

test('intake imports normalize only current-step choices and retain Continue persistence', () => {
  const state = createEmptyCase();
  const initial = {...intakeAnswersFromCase(state),fullName:'Before',helpFor:'myself' as const,visaType:'eb1a' as const,criteria:['C04'],criteriaUnsure:false,majorAward:'yes' as const,birthCountry:'OTHER',birthCountryOther:'Historical territory'};
  const visa = applyIntakeImportPatch(initial,'visa',{visaType:'e1'});
  assert.equal(visa.visaType,'e1'); assert.deepEqual(visa.criteria,[]); assert.equal(visa.majorAward,'');
  const birth = applyIntakeImportPatch(initial,'birth',{birthCountry:'CA'});
  assert.equal(birth.birthCountryOther,'');
  const criteria = applyIntakeImportPatch(initial,'criteria',{criteriaUnsure:true});
  assert.deepEqual(criteria.criteria,[]);
  assert.throws(()=>applyIntakeImportPatch(initial,'criteria',{criteriaUnsure:true,criteria:['C05']}),/not both/);
  assert.throws(()=>applyIntakeImportPatch(initial,'basics',{visaType:'e1'}),/current form/);
  const imported = applyIntakeImportPatch(initial,'basics',{fullName:'Jordan Rivera',phone:'+1 202 555 0108'});
  assert.equal(state.profile.fullName,'', 'import itself does not save');
  const saved = applyIntakeStep(state,'basics',imported);
  assert.equal(saved.intake!.answers.fullName,'Jordan Rivera');
  assert.equal(saved.intake!.answers.visaType,'', 'future-step answers are not persisted by this step');
  assert.equal(saved.profile.fullName,'', 'existing completion behavior stays authoritative');
});

test('import action paths preserve source identity and invalidate existing reviews', () => {
  const sample = createSampleCase(); sample.forms.reviewed = true;
  const profilePatch = buildImportPatch(PROFILE_IMPORT_FIELDS,[{key:'fullName',value:'Jordan Rivera',excerpt:'Name',selected:true}],{...sample.profile}).patch;
  const profile = applyAction(sample,{type:'profile',patch:{...profilePatch,confirmed:false}});
  assert.equal(profile.profile.confirmed,false);
  assert.equal(profile.forms.reviewed,false);
  assert.equal(profile.runs.C08.result!.stale,true);
  assert.deepEqual(profile.documents,sample.documents);
  const worksheet = applyAction(sample,{type:'forms',patch:{...buildImportPatch(WORKSHEET_IMPORT_FIELDS,[{key:'address',value:'123 Example Street',excerpt:'',selected:true}],{...sample.forms}).patch,reviewed:false}});
  assert.equal(worksheet.forms.reviewed,false);
  const statement = buildImportPatch(DRAFT_IMPORT_FIELDS,[{key:'text',value:'My applicant statement.',excerpt:'',selected:true}],{}).patch.text as string;
  const manual = applyAction(sample,{type:'manual_section',criterion:'C08',text:statement});
  assert.equal(manual.runs.C08.result!.claims[0].supportStatus,'evidence_missing');
  assert.equal(manual.runs.C08.result!.claims[0].reviewStatus,'unreviewed');
  assert.deepEqual(manual.runs.C08.result!.claims[0].citations,[]);
  const claim = sample.runs.C08.result!.claims[0];
  const revised = applyAction(sample,{type:'edit_claim',target:'C08',claimId:claim.id,text:statement});
  assert.equal(revised.runs.C08.result!.claims[0].reviewStatus,'unreviewed');
  assert.equal(revised.runs.C08.result!.claims[0].supportStatus,'needs_review');
  assert.deepEqual(revised.runs.C08.result!.claims[0].citations,claim.citations);
  const fact = sample.facts[0];
  const correction = buildImportPatch(factImportFields(fact.label),[{key:'value',value:'Jordan Rivera',excerpt:'',selected:true}],{value:fact.value,reason:fact.reason}).patch;
  const corrected = applyAction(sample,{type:'fact',id:fact.id,value:correction.value as string,reason:'Applicant correction after review.',status:'corrected'});
  assert.equal(corrected.facts[0].originalValue,fact.originalValue);
  assert.equal(corrected.facts[0].sourceId,fact.sourceId);
  assert.equal(corrected.facts[0].page,fact.page);
  assert.equal(corrected.consent,sample.consent);
  assert.ok(caseSchema.safeParse(profile).success);
  assert.ok(caseSchema.safeParse(worksheet).success);
  assert.ok(caseSchema.safeParse(corrected).success);
});
