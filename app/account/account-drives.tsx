import { ArrowUpRight, FolderOpen } from "lucide-react";
import styles from "./account.module.css";

export default function AccountDrives({ userId }: { userId: string }) {
  if (!userId) return null;
  return <section className={styles.card}>
    <h2><FolderOpen size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />Evidence & connected locations</h2>
    <p className={styles.cardDesc}>Manage cloud connections, uploaded files, and evidence folders together in your Evidence library.</p>
    <a href="/workspace?view=evidence" className={styles.navLink}>Open Evidence library <ArrowUpRight size={15} style={{ verticalAlign: "middle" }} /></a>
  </section>;
}
