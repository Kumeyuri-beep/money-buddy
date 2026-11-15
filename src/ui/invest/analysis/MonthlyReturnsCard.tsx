import { Dash } from './Dash';
import type { AnalysisModel } from './analysisModel';
import { THAI_MONTHS_SHORT, naReasonText, signedPercentBps, toneOf } from './format';

/** ตารางผลตอบแทนรายเดือน (Modified Dietz · R25.4): แถว = ปี คอลัมน์ ม.ค.-ธ.ค. + ทั้งปี · เซลล์เขียว/แดงพร้อมเครื่องหมาย +/- · null = "—" พร้อมเหตุผล */
export function MonthlyReturnsCard({ model }: { model: AnalysisModel }) {
  return (
    <section className="solid card an-card" aria-labelledby="an-mon-title">
      <h2 id="an-mon-title">ผลตอบแทนรายเดือน</h2>
      {model.monthly.length === 0 ? (
        <p className="muted">ยังไม่มีผลตอบแทนให้แสดง เมื่อมีหุ้นสหรัฐและรายการซื้อ ตารางจะขึ้นที่นี่</p>
      ) : (
        <>
          <div className="migrate-table-wrap" role="region" aria-label="ตารางผลตอบแทนรายเดือน เลื่อนซ้ายขวาได้" tabIndex={0}>
            <table className="migrate-table an-table an-months">
              <caption className="sr-only">ผลตอบแทนรายเดือนและทั้งปีของพอร์ตหุ้นสหรัฐ เป็นเปอร์เซ็นต์ คิดเป็นบาท</caption>
              <thead>
                <tr>
                  <th scope="col">ปี</th>
                  {THAI_MONTHS_SHORT.map((m) => (
                    <th key={m} scope="col" className="num">
                      {m}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    ทั้งปี
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.monthly.map((y) => (
                  <tr key={y.year}>
                    <th scope="row">{y.year}</th>
                    {y.cells.map((c, i) => (
                      <td key={i} className={`num an-cell${c.kind === 'ok' ? ` an-cell-${toneOf(c.bps)}` : ''}`}>
                        {c.kind === 'ok' ? signedPercentBps(c.bps) : c.kind === 'na' ? <Dash why={naReasonText(c.reason)} /> : ''}
                      </td>
                    ))}
                    <td className={`num an-cell an-total${y.total === null ? '' : ` an-cell-${toneOf(y.total)}`}`}>
                      {y.total === null ? <Dash why="มีเดือนที่คำนวณไม่ได้ จึงรวมทั้งปีไม่ได้" /> : signedPercentBps(y.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            คิดเป็นบาท (รวมผลจากค่าเงิน) แบบ Modified Dietz ถ่วงน้ำหนักตามวันที่เงินเข้าออก รวมปันผลหลังภาษี · ทั้งปีเชื่อมจากรายเดือน · "—" = คำนวณไม่ได้ (ไม่มีราคาหรืออัตราของเดือนนั้น) ระบบไม่เดา
          </p>
        </>
      )}
    </section>
  );
}
