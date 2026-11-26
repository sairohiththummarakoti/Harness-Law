"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronDown, FileText, FolderOpen, LayoutDashboard, Link2, ListChecks, LockKeyhole, Menu, PencilLine, Scale, ShieldCheck, UserRound, X } from "lucide-react";
import styles from "./landing.module.css";

const stages = [
  { title: "Build profile", headline: "Begin with the work that makes you, you.", body: "Give your preparation a starting point. Bring together your professional field, experience, and the details you’ll review as you build your case.", note: "A short setup. Room for your whole story.", icon: UserRound },
  { title: "Organize evidence", headline: "Bring your experience into focus.", body: "Keep your documents in one library and connect sources to the EB-1A criteria you choose. See what you have and what still needs attention.", note: "One source, connected wherever it matters.", icon: FolderOpen },
  { title: "Develop narrative", headline: "Make space for a thoughtful first draft.", body: "Write your criterion sections, assemble them into a working draft, and keep the source material close. Your words stay editable as your case develops.", note: "Your draft takes shape at your pace.", icon: PencilLine },
  { title: "Review draft", headline: "See the details. Keep your judgment.", body: "Review claims, sources, and open questions together. Evidence support and human review remain separate, so you can see what still needs your attention.", note: "A working draft, ready for a closer look.", icon: ListChecks },
];

const questions: { id?: string; q: string; a: string }[] = [
  { id: "businesses", q: "Can I prepare an intake for an employee?", a: "Yes. Select “My employees” in the guided intake and enter the applicant’s background. Each account currently holds one applicant case. Dedicated employer dashboards and team access are not available yet." },
  { id: "attorney-review", q: "Can I work with an attorney?", a: "You can download a working draft to discuss with your own immigration attorney. Harness Law currently provides preparation tools; attorney engagement, invitations, and legal representation are not offered through this portal." },
  { q: "What can I prepare with Harness Law?", a: "Harness Law currently supports EB-1A preparation. You can build your profile, select criteria, organize documents, write manual sections, assemble a working draft, and track items that need review. The guided intake can save other visa interests; the preparation tools currently support EB-1A." },
  { q: "Do I need to know where to start?", a: "No. A guided intake asks about your visa plans, country of birth, citizenships, and work. If you choose EB-1A, you can select the criteria you think may apply or choose “I’m not sure yet.” Your answers save as you continue, and your selected criteria provide a starting point for an empty EB-1A workspace." },
  { q: "Can I explore before creating a workspace?", a: "Yes. Open the fictional sample to try the workflow without signing in or sharing personal information. Maya Chen, the documents, and every claim in the sample are fictional and must not be used for filing." },
  { q: "How do I access my personal case?", a: "Sign in to open your personal workspace. Your case is saved to your signed-in account, separate from the fictional sample. You can return to continue your preparation; the workspace shows whether your latest changes have been saved." },
  { q: "Does Harness Law provide legal advice or file my petition?", a: "No. This is a preparation workspace, not legal advice, a determination of eligibility, or an attorney service. Live AI drafting, document extraction, official form assembly, and petition filing are not connected. A qualified immigration attorney can advise you on your individual circumstances." },
];

function Brand() {
  return <Link className={styles.brand} href="/" aria-label="Harness Law home"><span className={styles.brandMark}><Scale size={25} aria-hidden="true" /></span><span>Harness Law<span className={styles.brandDot}>.</span></span></Link>;
}

function ProductPreview() {
  return <div className={styles.previewScene}>
    <div className={styles.previewTopline}><span><span className={styles.statusDot} /> A place for the full picture</span><span>Fictional sample workspace</span></div>
    <div className={styles.productWindow} aria-label="Fictional workspace preview for Maya Chen">
      <aside className={styles.productSidebar} aria-hidden="true">
        <div className={styles.productBrand}><Scale size={21} /> Harness Law</div>
        <div className={styles.samplePerson}><span>MC</span><div><strong>Maya Chen</strong><small>Fictional EB-1A case</small></div></div>
        <span className={styles.navCaption}>YOUR WORKSPACE</span>
        <div className={styles.mockNavActive}><LayoutDashboard size={16} /> Overview</div>
        <div className={styles.mockNav}><UserRound size={16} /> Your profile</div>
        <div className={styles.mockNav}><ListChecks size={16} /> Your criteria</div>
        <div className={styles.mockNav}><FolderOpen size={16} /> Evidence library</div>
        <div className={styles.mockNav}><PencilLine size={16} /> Working draft</div>
        <div className={styles.sidebarFoot}><LockKeyhole size={16} /><span>Your story.<br />Your workspace.</span></div>
      </aside>
      <div className={styles.productBody}>
        <div className={styles.productBar}><span>My case <span>/</span> Overview</span><span className={styles.sampleBadge}>Fictional sample</span></div>
        <div className={styles.productContent}>
          <div className={styles.previewGreeting}><div><span className={styles.overline}>YOUR EB-1A PREPARATION</span><h2>Your work. Brought together.</h2><p>A clearer view of your evidence and your next steps.</p></div><span className={styles.avatar}>MC</span></div>
          <div className={styles.previewSummary}><span><FolderOpen size={17} /><strong>6</strong> sample documents</span><span><ListChecks size={17} /><strong>4</strong> selected criteria</span><span><PencilLine size={17} /> A story taking shape</span></div>
          <div className={styles.previewColumns}>
            <div className={styles.evidencePreview}>
              <div className={styles.previewCardTitle}><h3>Evidence library</h3><FolderOpen size={17} /></div>
              <div className={styles.documentRow}><span className={styles.fileIcon}><FileText size={20} /></span><div><strong>Maya_Chen_CV.pdf</strong><small>Professional background · 3 pages</small></div><span className={styles.sourceTag}>A-1</span></div>
              <div className={styles.documentRow}><span className={styles.fileIcon}><FileText size={20} /></span><div><strong>Northstar_role_letter.pdf</strong><small>Leading or critical role · 2 pages</small></div><span className={styles.sourceTag}>F-1</span></div>
              <div className={styles.documentRow}><span className={styles.fileIcon}><FileText size={20} /></span><div><strong>Medical_imaging_publication.pdf</strong><small>Scholarly authorship · 8 pages</small></div><span className={styles.sourceTag}>E-1</span></div>
              <div className={styles.previewBottomNote}><Link2 size={15} /> Keep source material connected to your story.</div>
            </div>
            <div className={styles.draftPreview}>
              <div className={styles.previewCardTitle}><h3>A closer look at your draft</h3><PencilLine size={17} /></div>
              <span className={styles.criterionLabel}>LEADING OR CRITICAL ROLE</span>
              <p>Maya Chen serves as <mark>Principal Research Scientist</mark> and leads the medical imaging research program.</p>
              <div className={styles.citationPreview}><FileText size={14} /> Northstar role letter · page 1</div>
              <div className={styles.reviewNote}><span className={styles.reviewDot} /><div><strong>A question to follow up</strong><p>Add independent evidence of the organization’s reputation.</p></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div className={styles.previewCaption}><span>An illustrative view. All people and evidence shown are fictional.</span><a href="/workspace?sample=1">Explore the sample workspace</a></div>
  </div>;
}

function StagePreview({ stage }: { stage: number }) {
  return <div className={styles.stageVisual}>
    <span className={styles.visualLabel}>FICTIONAL SAMPLE · MAYA CHEN</span>
    {stage === 0 && <div className={styles.profileSheet}>
      <div className={styles.profileHeading}><span className={styles.largeAvatar}>MC</span><div><h3>Maya Chen</h3><p>Researcher. Builder. Collaborator.</p></div></div>
      <div className={styles.profileField}><span>Professional field</span><strong>Artificial intelligence & medical imaging</strong></div>
      <div className={styles.profileField}><span>Current role</span><strong>Principal Research Scientist</strong></div>
      <div className={styles.profileField}><span>Preparation goal</span><strong>Bring my evidence together</strong></div>
      <p className={styles.sheetNote}>Profile facts remain yours to review and confirm.</p>
    </div>}
    {stage === 1 && <div className={styles.evidenceSheet}>
      <div className={styles.sheetHeading}><FolderOpen size={24} /><div><h3>A library with context</h3><p>Every source has a place.</p></div></div>
      {[['Northstar role letter', 'Leading or critical role', 'F-1'], ['Medical imaging publication', 'Scholarly authorship', 'E-1'], ['Research impact and service', 'Original contributions', 'D-1']].map(([name, criterion, exhibit]) => <div className={styles.stageDocument} key={name}><FileText size={22} /><div><strong>{name}</strong><span>{criterion}</span></div><small>{exhibit}</small></div>)}
      <div className={styles.sheetFooter}><Link2 size={16} /> One source can support more than one criterion.</div>
    </div>}
    {stage === 2 && <div className={styles.narrativeSheet}>
      <div className={styles.sheetHeading}><PencilLine size={23} /><div><h3>The work behind the words</h3><p>Working draft · scholarly authorship</p></div></div>
      <p className={styles.narrativeText}>Maya Chen co-authored <mark>“Low-resource image analysis for collaborative research,”</mark> published in June 2024.</p>
      <div className={styles.sourceExcerpt}><span><FileText size={16} /> Medical imaging publication · page 1</span><p>Authors: Maya Chen, Alex Rivera, and Priya Shah<br />Published: June 2024.</p></div>
      <div className={styles.sheetFooter}><BookOpen size={16} /> Keep the draft and its supporting source together.</div>
    </div>}
    {stage === 3 && <div className={styles.reviewSheet}>
      <div className={styles.sheetHeading}><ListChecks size={24} /><div><h3>A deliberate review</h3><p>Leading or critical role</p></div></div>
      <div className={styles.reviewRow}><Check size={18} /><div><strong>Source linked</strong><span>Northstar role letter · page 1</span></div></div>
      <div className={styles.reviewRow}><Check size={18} /><div><strong>Applicant review recorded</strong><span>For this sample claim and revision</span></div></div>
      <div className={styles.openQuestion}><span>STILL TO CONSIDER</span><p>What independent evidence establishes the organization’s reputation?</p></div>
      <div className={styles.sheetFooter}><ShieldCheck size={16} /> Review status is separate from evidence support.</div>
    </div>}
  </div>;
}

export default function Landing() {
  const [stage, setStage] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = stages[stage];
  function handleTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % stages.length;
    else if (event.key === 'ArrowLeft') next = (index + stages.length - 1) % stages.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stages.length - 1;
    else return;
    event.preventDefault();
    setStage(next);
    tabRefs.current[next]?.focus();
  }
  return <div className={styles.landing}>
    <a className={styles.skipLink} href="#main-content">Skip to content</a>
    <header className={styles.cinematicHeader}>
      <div className={styles.cinematicNav}>
        <Brand />
        <nav className={styles.audienceNav} aria-label="Main navigation"><a href="#individuals">For individuals</a><a href="#businesses">For businesses</a><a href="#attorney-review">Attorneys</a></nav>
        <div className={styles.cinematicActions}><a className={styles.navResource} href="#how-it-works">Resources</a><a className={styles.navResource} href="#about">About us</a><a className={styles.signInButton} href="/signin">Sign in</a><a className={styles.getStartedButton} href="/signup">Get started</a><button type="button" className={styles.cinematicMenuButton} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button></div>
      </div>
      {menuOpen && <nav className={styles.cinematicMobileNav} id="mobile-navigation" aria-label="Mobile navigation"><a onClick={() => setMenuOpen(false)} href="#individuals">For individuals</a><a onClick={() => setMenuOpen(false)} href="#businesses">For businesses</a><a onClick={() => setMenuOpen(false)} href="#attorney-review">Attorneys</a><a onClick={() => setMenuOpen(false)} href="#how-it-works">Resources</a><a onClick={() => setMenuOpen(false)} href="#about">About us</a><a href="/signin">Sign in</a><a href="/signup">Get started</a></nav>}
    </header>
    <main id="main-content">
      <section className={styles.cinematicHero} aria-labelledby="hero-title">
        <div className={styles.heroArtwork} aria-hidden="true"><img src="/images/harness-horizon.webp" alt="" width="1254" height="1254" fetchPriority="high" /></div>
        <div className={styles.cinematicContent}>
          <div className={styles.heroCopy}>
            <p className={styles.heroBadge}>A NEW PERSPECTIVE ON EB-1A PREPARATION</p>
            <h1 id="hero-title">Your talent.<br /><span>A new horizon.</span></h1>
            <p className={styles.heroDescription}>You’ve built a career worth telling. Bring your achievements, evidence, and ambitions together and take a thoughtful next step.</p>
            <div className={styles.heroLinks}><a className={styles.heroStartButton} href="/signup">Begin your next chapter</a></div>
          </div>
        </div>
        <div className={styles.heroFoot}><a href="#individuals">Discover a clearer way to prepare <ChevronDown size={18} aria-hidden="true" /></a><span>YOUR EXPERIENCE. YOUR EVIDENCE. YOUR STORY.</span></div>
      </section>
      <div className={styles.disciplineStrip} aria-label="Fields of achievement"><span>Science</span><span>Technology</span><span>Business</span><span>Arts</span><span>Education</span><span>Athletics</span></div>
      <section id="individuals" className={`${styles.container} ${styles.introduction}`} aria-labelledby="intro-title"><p className={styles.eyebrow}>YOUR NEXT CHAPTER, WITH MORE CLARITY</p><h2 id="intro-title">Big ambitions.<br /><span className={styles.editorialAccent}>One place to get organized.</span></h2><p>Preparing a talent visa case can mean connecting years of work. Harness Law gives your EB-1A preparation a home, from the first document to a carefully reviewed working draft.</p><div id="workspace" className={styles.workspaceShowcase}><ProductPreview /></div></section>
      <section id="how-it-works" className={`${styles.container} ${styles.walkthrough}`} aria-labelledby="walkthrough-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>FROM EXPERIENCE TO EVIDENCE</p><h2 id="walkthrough-title">Make your next step<br />a clear one.</h2></div><p>A flexible place to prepare.<br />{' '}Start where you are. Build as you go.</p></div>
        <div className={styles.stageTabs} role="tablist" aria-label="Preparation stages">{stages.map((item, index) => <button key={item.title} ref={el => { tabRefs.current[index] = el; }} id={`stage-tab-${index}`} type="button" role="tab" aria-selected={stage === index} aria-controls="stage-panel" tabIndex={stage === index ? 0 : -1} onKeyDown={event => handleTabs(event, index)} onClick={() => setStage(index)} className={stage === index ? styles.selectedTab : undefined}>{item.title}</button>)}</div>
        <div id="stage-panel" role="tabpanel" aria-labelledby={`stage-tab-${stage}`} tabIndex={0} className={styles.stagePanel}><div className={styles.stageCopy}><span className={styles.stageIcon}><active.icon size={27} /></span><h3>{active.headline}</h3><p>{active.body}</p><span className={styles.stageNote}>{active.note}</span><a className={styles.textLink} href="/signup">Start your preparation</a></div><StagePreview stage={stage} /></div>
      </section>
      <section id="about" className={`${styles.container} ${styles.capabilities}`} aria-labelledby="capabilities-title"><div className={styles.capabilitiesIntro}><p className={styles.eyebrow}>THOUGHTFUL BY DESIGN</p><h2 id="capabilities-title">Your story has details.<br />Keep them connected.</h2><p>A workspace that makes room for the documents, decisions, and revisions behind your preparation.</p><a className={styles.secondaryButton} href="/workspace?sample=1">See it in the sample</a></div><div className={styles.capabilityRows}>
        <article><span className={styles.capabilityIcon}><FolderOpen size={25} /></span><div><h3>A source stays a source</h3><p>Organize documents once and associate them with relevant criteria. Keep the source identity and version visible.</p></div></article>
        <article><span className={styles.capabilityIcon}><PencilLine size={25} /></span><div><h3>A draft stays in your hands</h3><p>Write and revise your sections, assemble a working draft, and return to earlier revisions as your thinking develops.</p></div></article>
        <article><span className={styles.capabilityIcon}><ShieldCheck size={25} /></span><div><h3>Open questions stay visible</h3><p>Track unresolved facts and review needs. A completed step never turns an unverified claim into a confirmed fact.</p></div></article>
      </div></section>
      <section id="faqs" className={`${styles.container} ${styles.faqSection}`} aria-labelledby="faq-title"><div><p className={styles.eyebrow}>A FEW THINGS TO KNOW</p><h2 id="faq-title">A little more<br />{' '}clarity.</h2><p>Before you take the first step.</p></div><div className={styles.faqList}>{questions.map(item => <details key={item.q} id={item.id} className={styles.faq}><summary>{item.q}<ChevronDown size={20} aria-hidden="true" /></summary><p>{item.a}</p></details>)}</div></section>
      <section className={`${styles.container} ${styles.finalSection}`} aria-labelledby="final-title"><div className={styles.finalCta}><div><p className={styles.eyebrow}>THERE’S A STORY BEHIND YOUR WORK</p><h2 id="final-title">Give your next chapter<br />{' '}a thoughtful beginning.</h2><p>Start with what you know. Bring the rest together.</p></div><div className={styles.finalActions}><a className={styles.primaryButton} href="/signup">Get started</a><span>Your personal EB-1A workspace.</span></div></div></section>
    </main>
    <footer className={`${styles.container} ${styles.footer}`}><div className={styles.footerTop}><Brand /><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="/workspace?sample=1">Sample workspace</a><a href="/signin">Log in</a></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Harness Law</span><p>A preparation workspace. Not legal advice, an eligibility decision, or a filing service.</p></div></footer>
  </div>;
}
