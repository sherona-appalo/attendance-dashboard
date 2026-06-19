import pandas as pd
import json

# ─── Load Biometric (Face + Fingerprint) ──────────────────────────────────────
df = pd.read_excel("Biometric_Report.xlsx", sheet_name="Consolidated", header=3)

# Normalise column names
df.columns = df.columns.str.strip()

# Drop the unnamed first column (always NaN — it's a formatting column in the report)
if "Unnamed: 0" in df.columns:
    df = df.drop(columns=["Unnamed: 0"])

# Drop rows where User ID is NaN or empty (blank spacer rows & garbage rows)
df["User ID"] = df["User ID"].astype(str).str.strip()
df = df[df["User ID"].notna()]
df = df[~df["User ID"].isin(["", "nan", "NaT", "NaN"])]

# Now filter on Name and Punch Time
df = df.dropna(subset=["Name", "Punch Time"])
df = df[df["Name"].astype(str).str.strip() != ""]
df["Punch Time"] = pd.to_datetime(df["Punch Time"], errors="coerce")
df = df.dropna(subset=["Punch Time"])
df["Date"]  = df["Punch Time"].dt.date
df["Name"]  = df["Name"].astype(str).str.strip()

# ── Split Face vs Fingerprint using "Punch Mode" column ──────────────────────
if "Punch Mode" in df.columns:
    df["Punch Mode"] = df["Punch Mode"].astype(str).str.strip()
    face_df = df[df["Punch Mode"].str.lower().str.contains("face", na=False)].copy()
    fp_df   = df[~df["Punch Mode"].str.lower().str.contains("face", na=False)].copy()
    fp_df   = fp_df[fp_df["Punch Mode"].str.lower() != "nan"]
else:
    print("⚠  'Punch Mode' column not found — all biometric records treated as Face.")
    print(f"   Available columns: {list(df.columns)}")
    face_df = df.copy()
    fp_df   = pd.DataFrame(columns=df.columns)

# ─── Load Great HR ────────────────────────────────────────────────────────────
ghr = pd.read_excel("GreatHR.xlsx", header=0)
ghr.columns = ghr.columns.str.strip()

ghr = ghr.rename(columns={
    "Employee Name": "Name",
    "Swipe Date":    "Punch Time",
})

ghr = ghr.dropna(subset=["Name", "Punch Time"])
ghr = ghr[ghr["Name"].astype(str).str.strip() != ""]
ghr["Punch Time"]   = pd.to_datetime(ghr["Punch Time"], errors="coerce")
ghr = ghr.dropna(subset=["Punch Time"])
ghr["Date"]         = ghr["Punch Time"].dt.date
ghr["Employee No"]  = ghr["Employee No"].fillna("").astype(str).str.strip()
ghr["Name"]         = ghr["Name"].astype(str).str.strip()


# ─── Helper: daily summary (one row per employee-day) ────────────────────────
def build_summary(src, id_col):
    rows = []
    for (name, uid, date), grp in src.groupby(["Name", id_col, "Date"], sort=False):
        times     = sorted(grp["Punch Time"].tolist())
        first_in  = times[0].strftime("%H:%M")
        last_out  = times[-1].strftime("%H:%M")
        hours     = round((times[-1] - times[0]).total_seconds() / 3600, 2)
        rows.append({
            "Name":          name,
            id_col:          str(uid),
            "Date":          str(date),
            "First_In":      first_in,
            "Last_Out":      last_out,
            "Hours":         hours,
            "Total_Punches": len(times),
        })
    return rows


# ─── Helper: individual punch events ─────────────────────────────────────────
def build_punches(src, id_col, mode_label, device_col=None):
    rows = []
    for (name, uid, date), grp in src.groupby(["Name", id_col, "Date"], sort=False):
        times = sorted(grp["Punch Time"].tolist())
        for i, t in enumerate(times):
            row = {
                "Name":  name,
                id_col:  str(uid),
                "Date":  str(date),
                "Time":  t.strftime("%H:%M:%S"),
                "Seq":   i + 1,
                "Mode":  mode_label,
                "Device": "Great HR" if mode_label == "greathr" else "",
            }
            if device_col and device_col in grp.columns:
                # pick the device value for this specific punch row by timestamp
                match = grp[grp["Punch Time"] == t]
                if not match.empty:
                    raw = str(match.iloc[0][device_col]).strip()
                    row["Device"] = "" if raw in ("nan", "NaT", "NaN", "") else raw
            rows.append(row)
    return rows


# ─── Build & export ───────────────────────────────────────────────────────────
face_summary = build_summary(face_df, "User ID")
fp_summary   = build_summary(fp_df,   "User ID")
ghr_summary  = build_summary(ghr,     "Employee No")

face_punches = build_punches(face_df, "User ID",     "face",        device_col="Device/Source Detail")
fp_punches   = build_punches(fp_df,   "User ID",     "fingerprint", device_col="Device/Source Detail")
ghr_punches  = build_punches(ghr,     "Employee No", "greathr")

all_punches  = face_punches + fp_punches + ghr_punches

with open("face_summary.json",        "w") as f: json.dump(face_summary, f)
with open("fingerprint_summary.json", "w") as f: json.dump(fp_summary,   f)
with open("greathr_summary.json",     "w") as f: json.dump(ghr_summary,  f)
with open("punch_details.json",       "w") as f: json.dump(all_punches,  f)

print(f"✅  Face        : {len(face_summary):>5} day-records  |  {len(face_punches):>6} punches")
print(f"✅  Fingerprint : {len(fp_summary):>5} day-records  |  {len(fp_punches):>6} punches")
print(f"✅  Great HR    : {len(ghr_summary):>5} day-records  |  {len(ghr_punches):>6} punches")
print(f"✅  punch_details.json : {len(all_punches)} total punch events")
print("─" * 52)
print("Run:  python -m http.server 8000")
print("Open: http://localhost:8000/index.html")