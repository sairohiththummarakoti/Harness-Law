"use client";

import type { ReactNode } from "react";
import { Banknote, BookOpen, BriefcaseBusiness, Clapperboard, Lightbulb, Newspaper, Palette, Plus, Scale, Trophy, UsersRound, type LucideIcon } from "lucide-react";
import { CRITERIA, GUIDANCE_URL } from "@/lib/model";
import styles from "./eb1a-guide.module.css";

const EB1_URL = "https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1";

const presentation: Record<string, { title: string; summary: string; icon: LucideIcon; color: string }> = {
  C01: { title: "Awards", summary: "Recognition for excellence in your field.", icon: Trophy, color: "gold" },
  C02: { title: "Memberships", summary: "Membership earned through outstanding achievement.", icon: UsersRound, color: "blue" },
  C03: { title: "Media coverage", summary: "Published coverage of you and your work.", icon: Newspaper, color: "rose" },
  C04: { title: "Judging", summary: "Evaluating the work of others in your field.", icon: Scale, color: "teal" },
  C05: { title: "Contributions", summary: "Original work with major significance.", icon: Lightbulb, color: "orange" },
  C06: { title: "Authorship", summary: "Scholarly articles you have written.", icon: BookOpen, color: "violet" },
  C07: { title: "Exhibitions", summary: "Your work shown in artistic exhibitions.", icon: Palette, color: "pink" },
  C08: { title: "Leading role", summary: "A leading or critical role at a distinguished organization.", icon: BriefcaseBusiness, color: "indigo" },
  C09: { title: "High pay", summary: "Compensation that stands out in your field.", icon: Banknote, color: "green" },
  C10: { title: "Commercial success", summary: "Commercial achievements in the performing arts.", icon: Clapperboard, color: "coral" },
};

export function criterionDisplayName(id: string) {
  return presentation[id]?.title || CRITERIA.find(criterion => criterion.id === id)?.shortTitle || id;
}

export function CriterionSymbol({ id, size = 27 }: { id: string; size?: number }) {
  const item = presentation[id];
  const Icon = item?.icon || BookOpen;
  return <span className={`${styles.symbol} ${styles[item?.color || "green"]}`} aria-hidden="true"><Icon size={size} strokeWidth={1.8} /></span>;
}

interface EB1AGuideProps {
  selectedCriteria: string[];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAddContext: () => void;
  updates?: ReactNode;
}

export function EB1AGuide({ selectedCriteria, onToggle, onOpen, onAddContext, updates }: EB1AGuideProps) {
  return <div className={styles.guide}>
    <header className={styles.heading}>
      <div>
        <span className={styles.eyebrow}>UNDERSTAND YOUR EVIDENCE</span>
        <h1>EB-1A Guide</h1>
        <p>Explore the USCIS evidence criteria. Choose the areas that reflect your achievements.</p>
      </div>
      <span className={styles.selectionCount} aria-live="polite">{selectedCriteria.length} selected</span>
    </header>

    {updates}

    <details className={styles.reviewGuide}>
      <summary><span className={styles.reviewTitle}><BookOpen size={20} aria-hidden="true" />How USCIS reviews EB-1A</span><Plus size={18} className={styles.expandIcon} aria-hidden="true" /></summary>
      <div className={styles.reviewBody}>
        <p>For the initial evidence step, USCIS considers a major, internationally recognized award, or evidence that meets at least three of the ten criteria below.</p>
        <p>USCIS then evaluates the full record for sustained national or international acclaim and whether you are among the small percentage at the top of your field. Selecting three tiles does not establish eligibility.</p>
        <p>You must also show that you will continue work in your area of expertise in the United States and that your entry will substantially benefit the United States.</p>
        <div className={styles.sourceLinks}><a href={EB1_URL} target="_blank" rel="noreferrer">USCIS EB-1 overview</a><a href={GUIDANCE_URL} target="_blank" rel="noreferrer">USCIS Policy Manual</a></div>
      </div>
    </details>

    <div className={styles.sectionHeading}><h2>Find the evidence that tells your story.</h2><p>Choose an area, then explore its requirements.</p></div>

    <div className={styles.tiles}>
      {CRITERIA.map(criterion => {
        const item = presentation[criterion.id];
        const selected = selectedCriteria.includes(criterion.id);
        return <article key={criterion.id} className={`${styles.tile} ${selected ? styles.selected : ""}`} aria-labelledby={`guide-${criterion.id}`}>
          <div className={styles.tileTop}>
            <CriterionSymbol id={criterion.id} />
            <label className={styles.selectControl}>
              <input type="checkbox" checked={selected} onChange={() => onToggle(criterion.id)} aria-label={`Include ${item.title} in my case`} />
              <span>{selected ? "Selected" : "Add to my case"}</span>
            </label>
          </div>
          <h3 id={`guide-${criterion.id}`}>{item.title}</h3>
          <p className={styles.summary}>{item.summary}</p>
          <details className={styles.requirements}>
            <summary aria-label={`See ${item.title} requirements`}><span>See requirements</span><Plus size={17} className={styles.expandIcon} aria-hidden="true" /></summary>
            <div className={styles.requirementsBody}>
              <p className={styles.detailLabel}>USCIS criterion, in plain language</p>
              <p>{criterion.description}</p>
              <h4>Evidence you could gather</h4>
              <ul>{criterion.examples.map(example => <li key={example}>{example}</li>)}</ul>
              <a className={styles.sourceLink} href={GUIDANCE_URL} target="_blank" rel="noreferrer">Read the official USCIS guidance</a>
              <button className={styles.openSection} type="button" onClick={() => onOpen(criterion.id)}>Open {item.title}</button>
            </div>
          </details>
        </article>;
      })}
    </div>

    <details className={styles.otherEvidence}>
      <summary><span>Have a major award or a different kind of evidence?</span><Plus size={18} className={styles.expandIcon} aria-hidden="true" /></summary>
      <div className={styles.reviewBody}>
        <p>A major, internationally recognized award is a separate initial-evidence route. Comparable evidence may be considered when the listed criteria do not readily apply to your occupation; explain why and how your evidence is comparable.</p>
        <p>You can record this context in your professional background. This workspace does not validate those alternative routes.</p>
        <button className={styles.contextButton} type="button" onClick={onAddContext}>Add context to my profile</button>
      </div>
    </details>
  </div>;
}

export default EB1AGuide;
