import {
  Component,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
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

  private allowedIframeOrigin = 'http://localhost:3001';
  private originalOrigin = 'https://kevins.com.co';

  constructor(
    private fb: FormBuilder,
    private sanitizer: DomSanitizer
  ) {
    this.form = this.fb.group({
      titulo: [''],
      descripcion: [''],
      linkActual: ['Navega por Kevins para capturar links...']
    });

    this.iframeSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.iframeUrl);
  }

  ngAfterViewInit() {
    this.miIframe.nativeElement.onload = () => {
      this.iframeLoaded = true;
      // No tocamos linkActual aquí para no pisar el valor capturado
    };
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Normaliza y quita /kevins si aparece en el path
  private normalizarKevinsUrl(input: string): string {
    if (!input) return '';

    let u: URL;
    try {
      u = new URL(input, this.originalOrigin);
    } catch {
      return input.trim();
    }

    const limpiarPath = (p: string) => (p || '/').replace(/^\/kevins(\/|$)/i, '/');

    // localhost -> kevins.com.co
    if (u.hostname === 'localhost') {
      return `${this.originalOrigin}${limpiarPath(u.pathname)}${u.search}${u.hash}`;
    }

    // kevins.com.co pero contaminado con /kevins
    if (u.hostname.endsWith('kevins.com.co')) {
      return `${this.originalOrigin}${limpiarPath(u.pathname)}${u.search}${u.hash}`;
    }

    return u.toString().trim();
  }

  // Actualiza el campo de link
  private setLinkActual(link: string) {
    const limpio = this.normalizarKevinsUrl(link);
    if (!limpio) return;
    this.form.patchValue({ linkActual: limpio }, { emitEvent: false });
  }

  // Recibir link capturado del iframe (tracker)
  @HostListener('window:message', ['$event'])
  onMessageFromIframe(event: MessageEvent) {
    // Validar origin por seguridad.
    if (event.origin !== this.allowedIframeOrigin) return;

    const data = event.data;
    if (!data || !data.tipo) return;

    // Cuando el usuario hace click en un enlace o elemento
    if (data.tipo === 'clickReal' && data.url) {
      const linkLimpio = this.normalizarKevinsUrl(data.url);
      const urlAnterior = this.form.get('linkActual')?.value;

      // Si el enlace cambia drásticamente (navegación a otra página o categoría), 
      // limpiamos el título y descripción que el usuario había escrito.
      if (urlAnterior !== linkLimpio) {
          this.form.reset({
             titulo: '',
             descripcion: '',
             linkActual: linkLimpio
          }, { emitEvent: false });
      }
      return;
    }

    // Cuando el usuario navega a otra sección del SPA (ej. categorías)
    if (data.tipo === 'navegacion' && data.url) {
       const linkLimpio = this.normalizarKevinsUrl(data.url);
       const urlAnterior = this.form.get('linkActual')?.value;

       // Si es una navegación genuina a otra URL, reiniciamos el formulario
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
    const payload = this.crearPayload();
    console.log('Formulario (local):', payload);
    this.mostrarMensaje('Registro exitoso!');
  }

  exportarJson() {
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

    this.mostrarMensaje('JSON exportado');
  }

  private crearPayload() {
    const v = this.form.getRawValue();
    return {
      titulo: (v.titulo ?? '').toString().trim(),
      descripcion: (v.descripcion ?? '').toString().trim(),
      link: this.normalizarKevinsUrl((v.linkActual ?? '').toString().trim()),
      timestamp: new Date().toISOString()
    };
  }

  private mostrarMensaje(msg: string) {
    this.mensajeEnvio = msg;
    setTimeout(() => (this.mensajeEnvio = ''), 3000);
  }
}