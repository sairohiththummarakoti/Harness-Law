"use client";

import { BookOpen, ChevronDown, ChevronRight, Fingerprint, FolderOpen, UserRound } from "lucide-react";
import styles from "./workspace-help.module.css";

const steps = [
  {
    page: "profile",
    icon: UserRound,
    title: "Start with your profile",
    description: "Add your personal details, professional background, and the story you want to tell. Review any answers you import before applying them.",
    action: "Open your profile",
  },
  {
    page: "evidence",
    icon: FolderOpen,
    title: "Organize your evidence",
    description: "Keep your documents together and connect them to relevant criteria. Uploaded files are stored privately; scanning and extraction are not available yet.",
    action: "Open evidence library",
  },
  {
    page: "facts",
    icon: Fingerprint,
    title: "Check facts against sources",
    description: "Review available facts, flag discrepancies, and leave uncertain details unresolved. The sample demonstrates this step; personal uploads do not generate source facts yet.",
    action: "Open facts & sources",
  },
  {
    page: "composition",
    icon: BookOpen,
    title: "Bring your sections together",
    description: "Choose your criteria and write manual sections, then select sections to assemble a working draft. Items that need evidence or review stay visible.",
    action: "Compose your case",
  },
] as const;

const questions = [
  {
    question: "Can I use the same file to fill different forms?",
    answer: "Yes. Upload file saves your document privately to Evidence before reading it in your browser. Browse Evidence lets you reuse a saved file without uploading another copy. Review the proposed answers before applying them. Organize files into folders in Evidence; moving a file keeps its source identity and criterion associations. Local form reading does not mark a source as scanned or verified, and imported answers still need your review.",
  },
  {
    question: "How do I know my changes are saved?",
    answer: "Changes to a signed-in personal case save automatically. Draft editors have their own Save manual section or Save revision buttons; use those to apply your text first. Before leaving, check for All changes saved in the top bar. If saving fails or a conflict appears, follow the message in your workspace. Keep that page open until you have resolved the issue or downloaded a local copy.",
  },
  {
    question: "What happens to changes in the fictional sample?",
    answer: "Sample changes are temporary and stay separate from your personal case. Reloading or leaving can discard them. Sample people, documents, and claims are fictional. Sign in to prepare your own case; signing in does not copy sample material into it. When you open the sample from your personal workspace, use Back to my case to return.",
  },
  {
    question: "Why does a section need review again?",
    answer: "Editing a paragraph resets its evidence-support and human-review status. Changing a linked source or relevant profile details can also make a section out of date. Check the current wording against its sources and review the affected section again. A completed sample run does not mean its claims have been reviewed.",
  },
  {
    question: "Is my downloaded draft a finished application?",
    answer: "Downloads are working drafts for review. They can include missing evidence, unresolved questions, and unreviewed sections. Official form assembly, final packet generation, and filing are not available in this workspace. Use Working draft to review the text and Final review to see the remaining items.",
  },
  {
    question: "How do I return to my overview or sign out?",
    answer: "Choose Overview or the Harness Law logo at the top of the sidebar to return to your workspace overview. To end your session, use Sign out in the account area at the bottom of the sidebar. Check that your changes are saved before signing out.",
  },
] as const;

export function WorkspaceHelp({ onNavigate }: { onNavigate: (page: string) => void }) {
  return <div className={styles.help}>
    <div className="page-heading">
      <div>
        <span className="eyebrow">A LITTLE GUIDANCE, AT YOUR PACE</span>
        <h1>Help &amp; guidance</h1>
        <p className="title-subtitle">Find your next step and understand how your workspace works.</p>
      </div>
    </div>

    <section aria-labelledby="workspace-help-start-title">
      <div className={styles.sectionHeading}>
        <h2 id="workspace-help-start-title">Start here, or pick up where you left off.</h2>
        <p>You can move between sections as your preparation takes shape.</p>
      </div>
      <div className={styles.steps}>
        {steps.map((step, index) => <article className={styles.step} key={step.page}>
          <div className={styles.stepTop}>
            <span className={styles.icon} aria-hidden="true"><step.icon size={21} /></span>
            <span className={styles.stepNumber} aria-hidden="true">0{index + 1}</span>
          </div>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          <button className={styles.cardAction} type="button" onClick={() => onNavigate(step.page)}>
            <span>{step.action}</span><ChevronRight size={17} aria-hidden="true" />
          </button>
        </article>)}
      </div>
    </section>

    <section className={styles.questions} aria-labelledby="workspace-help-questions-title">
      <div className={styles.sectionHeading}>
        <h2 id="workspace-help-questions-title">Common questions</h2>
        <p>A few useful details before you continue.</p>
      </div>
      <div className={styles.questionList}>
        {questions.map(item => <details className={styles.question} key={item.question}>
          <summary><span>{item.question}</span><ChevronDown size={19} aria-hidden="true" /></summary>
          <p>{item.answer}</p>
        </details>)}
      </div>
    </section>
  </div>;
}
