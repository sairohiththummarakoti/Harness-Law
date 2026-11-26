import styles from "./brand-logo.module.css";

/** The approved Softened H, with a transparent rising cut and opposing rounded corners. */
export function BrandMark() {
  return <svg className={styles.mark} viewBox="0 0 40 40" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M6 0H13V14L27 10.25V0H40V15L0 25V6A6 6 0 0 1 6 0ZM0 28.5L13 25.25V40H0ZM27 21.75L40 18.5V34A6 6 0 0 1 34 40H27Z" />
  </svg>;
}

export function BrandLogo({ inverse = false, className = "" }: { inverse?: boolean; className?: string }) {
  return <span className={`${styles.logo} ${inverse ? styles.inverse : ""} ${className}`}>
    <BrandMark />
    <span className={styles.wordmark}>Harness Law</span>
  </span>;
}
