import { PRIVACY_POLICY, PRIVACY_POLICY_VERSION } from '../domain/privacy/policy';

/** นโยบายความเป็นส่วนตัวฉบับเต็ม (ใช้ทั้งหน้ายอมรับและหน้าโปรไฟล์) · ระดับหัวข้อกำหนดได้ตามหน้าที่เรียก (h2 ใต้ h1 ของหน้ายอมรับ · h3 ใต้ h2 ของหน้าโปรไฟล์) */
export function PolicyText({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="policy-text">
      <p className="muted small">ฉบับวันที่ {PRIVACY_POLICY_VERSION}</p>
      {PRIVACY_POLICY.map((section) => (
        <section key={section.id} aria-labelledby={`policy-${section.id}`}>
          <Heading id={`policy-${section.id}`}>{section.title}</Heading>
          {section.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
