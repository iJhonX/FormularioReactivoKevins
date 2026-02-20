import {
  Component,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('miIframe') miIframe!: ElementRef<HTMLIFrameElement>;

  form: FormGroup;
  private destroy$ = new Subject<void>();

  iframeUrl = 'http://localhost:3001/kevins';
  iframeSafeUrl: SafeResourceUrl;

  iframeLoaded = false;
  mensajeEnvio = '';
  mensajeError = '';

  private allowedIframeOrigin = 'http://localhost:3001';
  private originalOrigin = 'https://kevins.com.co';

  constructor(
    private fb: FormBuilder,
    private sanitizer: DomSanitizer
  ) {
    this.form = this.fb.group({
      // Agregamos Validators.required para hacer obligatorios estos campos
      titulo: ['', Validators.required],
      descripcion: ['', Validators.required],
      linkActual: ['Navega por Kevins para capturar links...']
    });

    this.iframeSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.iframeUrl);
  }

  ngAfterViewInit() {
    this.miIframe.nativeElement.onload = () => {
      this.iframeLoaded = true;
    };
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private normalizarKevinsUrl(input: string): string {
    if (!input) return '';

    let u: URL;
    try {
      u = new URL(input, this.originalOrigin);
    } catch {
      return input.trim();
    }

    const limpiarPath = (p: string) => (p || '/').replace(/^\/kevins(\/|$)/i, '/');

    if (u.hostname === 'localhost') {
      return `${this.originalOrigin}${limpiarPath(u.pathname)}${u.search}${u.hash}`;
    }

    if (u.hostname.endsWith('kevins.com.co')) {
      return `${this.originalOrigin}${limpiarPath(u.pathname)}${u.search}${u.hash}`;
    }

    return u.toString().trim();
  }

  private setLinkActual(link: string) {
    const limpio = this.normalizarKevinsUrl(link);
    if (!limpio) return;
    this.form.patchValue({ linkActual: limpio }, { emitEvent: false });
  }

  @HostListener('window:message', ['$event'])
  onMessageFromIframe(event: MessageEvent) {
    if (event.origin !== this.allowedIframeOrigin) return;

    const data = event.data;
    if (!data || !data.tipo) return;

    if (data.tipo === 'clickReal' && data.url) {
      const linkLimpio = this.normalizarKevinsUrl(data.url);
      const urlAnterior = this.form.get('linkActual')?.value;

      if (urlAnterior !== linkLimpio) {
          this.form.reset({
             titulo: '',
             descripcion: '',
             linkActual: linkLimpio
          }, { emitEvent: false });
      }
      return;
    }

    if (data.tipo === 'navegacion' && data.url) {
       const linkLimpio = this.normalizarKevinsUrl(data.url);
       const urlAnterior = this.form.get('linkActual')?.value;

       if (urlAnterior !== linkLimpio) {
          this.form.reset({
             titulo: '',
             descripcion: '',
             linkActual: linkLimpio
          }, { emitEvent: false });
       }
       return;
    }
  }

  enviarFormulario() {
    // Si el formulario es inválido, marcamos los campos como tocados para que muestren los errores
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarError('⚠️ Por favor completa los campos obligatorios.');
      return;
    }

    const payload = this.crearPayload();
    console.log('Formulario (local):', payload);
    this.mostrarMensaje('Registro exitoso ✅');

  }

  exportarJson() {
    // También validamos al intentar exportar el JSON
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarError('⚠️ No se puede exportar: faltan campos obligatorios.');
      return;
    }

    const payload = this.crearPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `formulario-kevins-${ts}.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.mostrarMensaje('JSON exportado correctamente✅');

  }

  private crearPayload() {
    const v = this.form.getRawValue();
    return {
      titulo: (v.titulo ?? '').toString().trim(),
      descripcion: (v.descripcion ?? '').toString().trim(),
      link: this.normalizarKevinsUrl((v.linkActual ?? '').toString().trim()),
      timestamp: new Date().toLocaleDateString()
    };
  }

  private mostrarMensaje(msg: string) {
    this.mensajeError = ''; // Limpiar errores
    this.mensajeEnvio = msg;
    setTimeout(() => (this.mensajeEnvio = ''), 3500);
  }

  private mostrarError(msg: string) {
    this.mensajeEnvio = ''; // Limpiar mensaje de éxito
    this.mensajeError = msg;
    setTimeout(() => (this.mensajeError = ''), 4000);
  }
}