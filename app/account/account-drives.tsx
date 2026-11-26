"use client";

import { useState } from "react";
import DriveConnect from "../drive-connect";
import styles from "./account.module.css";

export default function AccountDrives({ userId }: { userId: string }) {
  const [notice, setNotice] = useState("");

  return (
    <div style={{ marginBottom: 24 }}>
      {notice && (
        <div role="status" className={styles.notice} style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}
      <DriveConnect userId={userId} onNotify={msg => setNotice(msg)} />
    </div>
  );
}
