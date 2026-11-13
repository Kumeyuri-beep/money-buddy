import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { downloadBackup } from './backup';
import { ViewLoadError } from './lazyViews';
import { getDerivedErrorState, shouldResetBoundary, type ErrorBoundaryState } from './errorBoundaryState';

interface Props {
  children: ReactNode;
  /** เปลี่ยนค่านี้ (เช่น ชื่อหน้า) เมื่อผู้ใช้ย้ายหน้า เพื่อให้ลองแสดงใหม่ */
  resetKey?: string;
  /** true = ตาข่ายชั้นนอกสุดของแอป (ไม่มีเมนูให้กลับ) แนะนำให้โหลดหน้าใหม่และมีปุ่มสำรองข้อมูล */
  root?: boolean;
}

interface State extends ErrorBoundaryState {
  backupMessage: string;
  /** ล้มเพราะโหลดไฟล์ของหน้าไม่สำเร็จ (ไม่เกี่ยวกับข้อมูล) */
  loadFailed: boolean;
}

/**
 * กันจอขาวทั้งแอปเมื่อมีข้อผิดพลาดตอน render (เช่น ข้อมูลยอดผิดปกติจากฐานข้อมูล)
 * ข้อความที่ผู้ใช้เห็นเป็นข้อความคงที่ ไม่แสดงรายละเอียดของ error · ข้อมูลในเครื่องไม่ถูกแตะ
 * บันทึกลงคอนโซลของเบราว์เซอร์เท่านั้น ไม่ส่งออกนอกเครื่อง
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, backupMessage: '', loadFailed: false };
  private readonly focusRef = createRef<HTMLElement>();

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState & { loadFailed: boolean } {
    return { ...getDerivedErrorState(), loadFailed: error instanceof ViewLoadError };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('หน้าจอแสดงผลไม่สำเร็จ', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props, prevState: State): void {
    if (shouldResetBoundary(this.state.hasError, prev.resetKey ?? '', this.props.resetKey ?? '')) {
      this.setState({ hasError: false, backupMessage: '', loadFailed: false });
      return;
    }
    // เพิ่งล้ม: ย้ายโฟกัสคีย์บอร์ดมาที่กล่องข้อความ (ปุ่มเดิมถูกแทนที่แล้ว)
    if (this.state.hasError && !prevState.hasError) this.focusRef.current?.focus();
  }

  private readonly backup = async (): Promise<void> => {
    try {
      await downloadBackup();
      this.setState({ backupMessage: 'ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว' });
    } catch {
      this.setState({ backupMessage: 'สำรองข้อมูลไม่สำเร็จ ลองปิดแล้วเปิดแอปใหม่' });
    }
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const { root } = this.props;
    if (this.state.loadFailed) {
      // โหลดไฟล์ของหน้าไม่สำเร็จ: ข้อความตรงเหตุจริง ไม่ทำให้ตกใจเรื่องเงิน
      return (
        <section ref={this.focusRef} tabIndex={-1} className="solid card error-fallback" role="alert">
          <h2>โหลดหน้านี้ไม่สำเร็จ</h2>
          <p>ข้อมูลของคุณยังอยู่ครบ ไม่ได้หายหรือถูกแก้ไข อาจเป็นเพราะอินเทอร์เน็ตสะดุด หรือแอปเพิ่งอัปเดต</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => this.setState({ hasError: false, loadFailed: false })}>
              ลองอีกครั้ง
            </button>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              โหลดหน้าใหม่
            </button>
          </div>
        </section>
      );
    }
    return (
      <section ref={this.focusRef} tabIndex={-1} className="solid card error-fallback" role="alert">
        <h2>เปิดหน้านี้ไม่ได้ชั่วคราว</h2>
        <p>ข้อมูลของคุณยังอยู่ครบ ไม่ได้หายหรือถูกแก้ไข อาจมีรายการที่ยอดเงินผิดปกติ</p>
        <p>
          {root
            ? 'ลองโหลดหน้านี้ใหม่ ถ้ายังเป็นอีก ให้ดาวน์โหลดไฟล์สำรองข้อมูลเก็บไว้ก่อน แล้วแจ้งผู้ดูแล'
            : 'ลองกดปุ่มด้านล่าง หรือไปหน้าอื่นจากเมนู ถ้ายังเป็นอีก ให้ไปที่หน้ารายการเพื่อหาแถวที่มีเครื่องหมาย ⚠'}
        </p>
        <div className="actions">
          {root ? (
            <>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                โหลดหน้าใหม่
              </button>
              <button className="btn btn-ghost" onClick={() => void this.backup()}>
                ดาวน์โหลดไฟล์สำรองข้อมูล
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => this.setState({ hasError: false })}>
              ลองอีกครั้ง
            </button>
          )}
        </div>
        {this.state.backupMessage ? <p role="status">{this.state.backupMessage}</p> : null}
      </section>
    );
  }
}
