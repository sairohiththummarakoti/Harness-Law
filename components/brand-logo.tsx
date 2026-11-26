import styles from "./brand-logo.module.css";

/** The approved lime puzzle symbol, shared by every Harness Law lockup. */
export function BrandMark() {
  return <img className={styles.mark} src="/brand/puzzle-mark.webp" width={256} height={256} alt="" aria-hidden="true" />;
}

export function BrandLogo({ inverse = false, className = "", tagline, taglineId, taglineClassName = "" }: {
  inverse?: boolean;
  className?: string;
  tagline?: string;
  taglineId?: string;
  taglineClassName?: string;
}) {
  return <span className={`${styles.logo} ${inverse ? styles.inverse : ""} ${className}`}>
    <BrandMark />
    <span className={styles.copy}>
      <span className={styles.wordmark}>Harness Law</span>
      {tagline && <span id={taglineId} className={`${styles.tagline} ${taglineClassName}`}>{tagline}</span>}
    </span>
  </span>;
}
