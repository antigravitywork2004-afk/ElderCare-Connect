import fs from "fs";
import { createClient } from "@supabase/supabase-js";

// Parse .env manually
let url = "";
let key = "";
try {
  const envFile = fs.readFileSync(".env", "utf8");
  envFile.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const k = match[1];
      let v = (match[2] || "").trim();
      if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (k === "VITE_SUPABASE_URL") url = v;
      if (k === "VITE_SUPABASE_PUBLISHABLE_KEY") key = v;
    }
  });
} catch (e) {
  console.error("Failed to read .env file:", e.message);
  process.exit(1);
}

const supabase = createClient(url, key);

async function checkColumns(tableName, cols) {
  console.log(`\n--- Table: ${tableName} ---`);
  for (const col of cols) {
    const { error } = await supabase.from(tableName).select(col).limit(1);
    if (error) {
      console.log(`❌ Column "${col}": ERROR - ${error.message} (${error.code || 'no code'})`);
    } else {
      console.log(`✅ Column "${col}": OK`);
    }
  }
}

async function run() {
  await checkColumns("wellbeing_checks", ["meals_logged", "water_intake", "sleep_quality", "pain_status", "energy_level", "feeling"]);
  await checkColumns("health_risk_assessments", ["heart_rate", "bp_systolic", "bp_diastolic", "age"]);
}

run();
