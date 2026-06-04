import type { HazardType } from "./types";

export type LanguageCode = "en" | "ar" | "hi" | "ur" | "bn" | "ne" | "ml" | "ta" | "tl";

export const RTL_LANGUAGES: LanguageCode[] = ["ar", "ur"];

export function isRTL(lang: string): boolean {
  return (RTL_LANGUAGES as string[]).includes(lang);
}

/**
 * Coaching-tone alert messages per worker language — the SafeLens differentiator
 * (doc §7). Tone is "careful — forklift approaching", never "you are violating
 * rules". English is the canonical fallback used for dashboard/records.
 */
const MESSAGES: Record<LanguageCode, Record<HazardType, string>> = {
  en: {
    unsafe_lift: "Bend your knees — keep your back straight.",
    ppe_missing: "Safety gear required — check helmet, vest and glasses.",
    person_proximity: "Person close by — keep a safe distance.",
    restricted_zone: "Restricted area — step back.",
    blocked_exit: "Emergency exit blocked — clear the path.",
    forklift_proximity: "Forklift approaching — move aside.",
    fall_risk: "Edge or fall risk — stop and steady yourself.",
  },
  ar: {
    unsafe_lift: "اثنِ ركبتيك وحافظ على استقامة ظهرك.",
    ppe_missing: "معدات السلامة مطلوبة — تحقق من الخوذة والسترة والنظارات.",
    person_proximity: "شخص قريب منك — حافظ على مسافة آمنة.",
    restricted_zone: "منطقة محظورة — تراجع للخلف.",
    blocked_exit: "مخرج الطوارئ مسدود — أخلِ الطريق.",
    forklift_proximity: "رافعة شوكية تقترب — ابتعد.",
    fall_risk: "خطر سقوط أو حافة — توقف وثبّت نفسك.",
  },
  hi: {
    unsafe_lift: "घुटने मोड़ें — पीठ सीधी रखें।",
    ppe_missing: "सुरक्षा उपकरण आवश्यक — हेलमेट, वेस्ट और चश्मा जाँचें।",
    person_proximity: "पास में व्यक्ति — सुरक्षित दूरी रखें।",
    restricted_zone: "प्रतिबंधित क्षेत्र — पीछे हटें।",
    blocked_exit: "आपातकालीन निकास अवरुद्ध — रास्ता साफ़ करें।",
    forklift_proximity: "फोर्कलिफ्ट आ रही है — हट जाएँ।",
    fall_risk: "गिरने का खतरा — रुकें और स्वयं को संभालें।",
  },
  ur: {
    unsafe_lift: "گھٹنے موڑیں — کمر سیدھی رکھیں۔",
    ppe_missing: "حفاظتی سامان ضروری — ہیلمٹ، جیکٹ اور عینک چیک کریں۔",
    person_proximity: "قریب میں شخص — محفوظ فاصلہ رکھیں۔",
    restricted_zone: "ممنوعہ علاقہ — پیچھے ہٹیں۔",
    blocked_exit: "ہنگامی راستہ بند — راستہ صاف کریں۔",
    forklift_proximity: "فورک لفٹ آ رہی ہے — ہٹ جائیں۔",
    fall_risk: "گرنے کا خطرہ — رکیں اور خود کو سنبھالیں۔",
  },
  bn: {
    unsafe_lift: "হাঁটু ভাঁজ করুন — পিঠ সোজা রাখুন।",
    ppe_missing: "সুরক্ষা সরঞ্জাম প্রয়োজন — হেলমেট, ভেস্ট ও চশমা দেখুন।",
    person_proximity: "কাছে একজন ব্যক্তি — নিরাপদ দূরত্ব রাখুন।",
    restricted_zone: "নিষিদ্ধ এলাকা — পিছিয়ে যান।",
    blocked_exit: "জরুরি বহির্গমন বন্ধ — পথ পরিষ্কার করুন।",
    forklift_proximity: "ফর্কলিফট আসছে — সরে যান।",
    fall_risk: "পড়ে যাওয়ার ঝুঁকি — থামুন ও নিজেকে স্থির করুন।",
  },
  ne: {
    unsafe_lift: "घुँडा खुम्च्याउनुहोस् — ढाड सीधा राख्नुहोस्।",
    ppe_missing: "सुरक्षा सामग्री आवश्यक — हेलमेट, भेस्ट र चस्मा जाँच्नुहोस्।",
    person_proximity: "नजिकै व्यक्ति — सुरक्षित दूरी राख्नुहोस्।",
    restricted_zone: "निषेधित क्षेत्र — पछाडि हट्नुहोस्।",
    blocked_exit: "आपतकालीन निकास बन्द — बाटो खाली गर्नुहोस्।",
    forklift_proximity: "फोर्कलिफ्ट आउँदै — पन्छिनुहोस्।",
    fall_risk: "खस्ने जोखिम — रोकिनुहोस् र आफूलाई सम्हाल्नुहोस्।",
  },
  ml: {
    unsafe_lift: "മുട്ടുകൾ മടക്കൂ — മുതുക് നേരെ വയ്ക്കൂ.",
    ppe_missing: "സുരക്ഷാ ഉപകരണം വേണം — ഹെൽമെറ്റ്, വെസ്റ്റ്, കണ്ണട പരിശോധിക്കൂ.",
    person_proximity: "അടുത്ത് ഒരാൾ — സുരക്ഷിത അകലം പാലിക്കൂ.",
    restricted_zone: "നിയന്ത്രിത മേഖല — പിന്നോട്ട് മാറൂ.",
    blocked_exit: "അടിയന്തര വാതിൽ തടഞ്ഞിരിക്കുന്നു — വഴി ഒഴിയൂ.",
    forklift_proximity: "ഫോർക്ക്‌ലിഫ്റ്റ് അടുക്കുന്നു — മാറിനിൽക്കൂ.",
    fall_risk: "വീഴ്ചാ സാധ്യത — നിർത്തി സ്വയം ഉറപ്പിക്കൂ.",
  },
  ta: {
    unsafe_lift: "முழங்கால்களை மடக்குங்கள் — முதுகை நேராக வைக்கவும்.",
    ppe_missing: "பாதுகாப்பு உபகரணம் தேவை — ஹெல்மெட், ஜாக்கெட், கண்ணாடி சரிபார்க்கவும்.",
    person_proximity: "அருகில் ஒருவர் — பாதுகாப்பான தூரத்தைப் பேணுங்கள்.",
    restricted_zone: "தடைசெய்யப்பட்ட பகுதி — பின்வாங்குங்கள்.",
    blocked_exit: "அவசர வழி அடைக்கப்பட்டுள்ளது — பாதையை அகற்றுங்கள்.",
    forklift_proximity: "ஃபோர்க்லிஃப்ட் நெருங்குகிறது — விலகுங்கள்.",
    fall_risk: "விழும் அபாயம் — நின்று உங்களை நிலைநிறுத்துங்கள்.",
  },
  tl: {
    unsafe_lift: "Iyuko ang tuhod — ituwid ang likod.",
    ppe_missing: "Kailangan ng safety gear — tingnan ang helmet, vest at salamin.",
    person_proximity: "May taong malapit — panatilihin ang ligtas na distansya.",
    restricted_zone: "Bawal na lugar — umatras.",
    blocked_exit: "Naharang ang emergency exit — linisin ang daanan.",
    forklift_proximity: "Paparating ang forklift — umiwas.",
    fall_risk: "Panganib na mahulog — huminto at magpakatatag.",
  },
};

/** The worker-facing alert message in the chosen language (English fallback). */
export function localizedMessage(hazardType: HazardType, lang: string): string {
  const table = MESSAGES[lang as LanguageCode] ?? MESSAGES.en;
  return table[hazardType] ?? MESSAGES.en[hazardType];
}
