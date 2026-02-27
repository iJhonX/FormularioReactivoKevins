import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('miIframe') miIframe!: ElementRef<HTMLIFrameElement>;
  
  form: FormGroup;
  private destroy$ = new Subject<void>();
  
  // URL base para el iframe local y dominios permitidos
  iframeUrl = 'http://localhost:3001/kevins/';
  iframeSafeUrl!: SafeResourceUrl;
  iframeLoaded = false;
  
  // Variables para la barra de navegación personalizada
  urlBaseKevins = 'https://kevins.com.co/';
  rutaEditable = ''; 

  mensajeEnvio = '';
  mensajeError = '';

  private allowedIframeOrigin = 'http://localhost:3001';
  private originalOrigin = 'https://kevins.com.co';

  // Array donde se guardan los registros acumulados
  registrosGuardados: any[] = [];
  textoBusqueda: string = '';

  get registrosFiltrados() {
    if (!this.textoBusqueda || this.textoBusqueda.trim() === '') {
      return [];
    }
    const texto = this.textoBusqueda.toLowerCase();
    return this.registrosGuardados.filter(registro => 
      (registro.titulo && registro.titulo.toLowerCase().includes(texto)) ||
      (registro.descripcion && registro.descripcion.toLowerCase().includes(texto)) ||
      (registro.keywords && registro.keywords.toLowerCase().includes(texto)) ||
      (registro.link && registro.link.toLowerCase().includes(texto))
    );
  }

  constructor(private fb: FormBuilder, private sanitizer: DomSanitizer) {
    this.form = this.fb.group({
      titulo: ['', Validators.required],
      descripcion: ['', Validators.required],
      keywords: [''],
      linkActual: ['Navega por Kevins para capturar links...']
    });

    this.iframeSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.iframeUrl);
  }

  ngOnInit() {
    const registrosGuardadosLocal = localStorage.getItem('kevins_registros');
    if (registrosGuardadosLocal) {
      this.registrosGuardados = JSON.parse(registrosGuardadosLocal);
    }

    const formGuardadoLocal = localStorage.getItem('kevins_formulario_actual');
    if (formGuardadoLocal) {
      this.form.patchValue(JSON.parse(formGuardadoLocal), { emitEvent: false });
    }

    this.form.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(values => {
        localStorage.setItem('kevins_formulario_actual', JSON.stringify(values));

        const tituloControl = this.form.get('titulo');
        const descControl = this.form.get('descripcion');
        const keywordsValue = values.keywords ? values.keywords.trim() : '';

        if (keywordsValue.length > 0) {
          tituloControl?.clearValidators();
          descControl?.clearValidators();
        } else {
          tituloControl?.setValidators([Validators.required]);
          descControl?.setValidators([Validators.required]);
        }

        tituloControl?.updateValueAndValidity({ emitEvent: false });
        descControl?.updateValueAndValidity({ emitEvent: false });
      });
      
      this.form.updateValueAndValidity({ emitEvent: false });
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

  actualizarFrameManual() {
    let rutaLimpia = this.rutaEditable;
    if (rutaLimpia.startsWith('/')) {
      rutaLimpia = rutaLimpia.substring(1);
    }

    const nuevaUrlLocal = `${this.iframeUrl}${rutaLimpia}`;
    this.iframeSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(nuevaUrlLocal);
    
    const urlOficial = `${this.urlBaseKevins}${rutaLimpia}`;
    this.form.patchValue({ linkActual: urlOficial }, { emitEvent: false });
  }

  private normalizarKevinsUrl(input: string): string {
    if (!input) return '';
    let u: URL;
    try {
      u = new URL(input, this.originalOrigin);
    } catch {
      return input.trim();
    }

    const limpiarPath = (p: string): string => {
      return p.replace(/^\/kevins/i, '');
    };

    if (u.hostname === 'localhost') {
      return this.originalOrigin + limpiarPath(u.pathname) + u.search + u.hash;
    }
    if (u.hostname.endsWith('kevins.com.co')) {
      return this.originalOrigin + limpiarPath(u.pathname) + u.search + u.hash;
    }

    return u.toString().trim();
  }

  @HostListener('window:message', ['$event'])
  onMessageFromIframe(event: MessageEvent) {
    if (event.origin !== this.allowedIframeOrigin) return;

    const data = event.data;
    if (!data || !data.tipo) return;

    if (data.tipo === 'clickReal' || data.tipo === 'navegacion') {
      const linkLimpio = this.normalizarKevinsUrl(data.url);
      const urlAnterior = this.form.get('linkActual')?.value;

      if (urlAnterior !== linkLimpio) {
        
        const registroExistente = this.registrosGuardados.find(r => r.link === linkLimpio);

        if (registroExistente) {
          this.form.patchValue({
            titulo: registroExistente.titulo || '',
            descripcion: registroExistente.descripcion || '',
            keywords: registroExistente.keywords || '',
            linkActual: linkLimpio
          }, { emitEvent: true });
          
          this.mostrarMensaje('Cargando datos guardados previamente...');
        } else {
          this.form.reset({
            titulo: '',
            descripcion: '',
            keywords: '',
            linkActual: linkLimpio
          }, { emitEvent: true });
        }
        
        try {
          const urlObj = new URL(linkLimpio);
          let path = urlObj.pathname + urlObj.search + urlObj.hash;
          if (path.startsWith('/')) path = path.substring(1);
          this.rutaEditable = path;
        } catch(e) {}
      }
      return;
    }
  }

  enviarFormulario() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarError('Por favor completa los campos obligatorios.');
      return;
    }

    const payload = this.crearPayload();
    const indexExistente = this.registrosGuardados.findIndex(r => r.link === payload.link);

    if (indexExistente !== -1) {
      const registroExistente = this.registrosGuardados[indexExistente];
      const huboActualizacion = (!registroExistente.titulo && payload.titulo) || 
                                (!registroExistente.descripcion && payload.descripcion) || 
                                (!registroExistente.keywords && payload.keywords) ||
                                (registroExistente.titulo !== payload.titulo) || 
                                (registroExistente.descripcion !== payload.descripcion) || 
                                (registroExistente.keywords !== payload.keywords);

      if (!huboActualizacion) {
        this.mostrarError('Este registro ya está guardado con estos mismos datos.');
        return;
      }

      registroExistente.titulo = payload.titulo;
      registroExistente.descripcion = payload.descripcion;
      registroExistente.keywords = payload.keywords;

      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`Registro actualizado | Total: ${this.registrosGuardados.length}`);
    } else {
      this.registrosGuardados.push(payload);
      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`Guardado en la lista | Total: ${this.registrosGuardados.length}`);
    }

    const linkActual = this.form.get('linkActual')?.value;
    this.form.reset({
      titulo: '',
      descripcion: '',
      keywords: '',
      linkActual: linkActual
    });
  }

  eliminarRegistro(registroAEliminar: any) {
    const indexReal = this.registrosGuardados.findIndex(r => r === registroAEliminar);
    if (indexReal !== -1) {
      this.registrosGuardados.splice(indexReal, 1);
      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`Registro eliminado | Quedan: ${this.registrosGuardados.length}`);
    }
  }

  // =====================================================================
  // NUEVAS FUNCIONES DE EXPORTACIÓN PARA FORMATO NGINX
  // =====================================================================

  private extraerLlaveDeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      let path = urlObj.pathname;
      path = path.replace(/^\/kevins\//i, '/');
      return path === '' ? '/' : path;
    } catch {
      let limpia = url.replace(/https?:\/\/[^\/]+/i, '');
      limpia = limpia.replace(/^\/kevins/i, '');
      if (!limpia.startsWith('/')) limpia = '/' + limpia;
      return limpia;
    }
  }

  private escaparTextoNginx(texto: string): string {
    if (!texto) return '';
    return texto.replace(/"/g, '\\"').replace(/'/g, "\\'");
  }

  exportarJson() {
    const registrosAExportar = [...this.registrosGuardados];

    if (this.form.valid && (this.form.value.titulo || this.form.value.descripcion)) {
      registrosAExportar.push(this.crearPayload());
    }

    if (registrosAExportar.length === 0) {
      this.mostrarError('No hay ningún registro guardado para exportar.');
      return;
    }

    // TÍTULOS
    let titulosConf = 'map $seo_key $page_meta_title {\n';
    titulosConf += '    default "Kevin\\\'s Joyeros | Colombia";\n';
    
    registrosAExportar.forEach(r => {
      if (r.titulo) {
        const llave = this.extraerLlaveDeUrl(r.link);
        const tituloSeguro = this.escaparTextoNginx(r.titulo);
        titulosConf += `    "${llave}" "${tituloSeguro}";\n`;
      }
    });
    titulosConf += '}\n';

    // DESCRIPCIONES
    let descripcionesConf = 'map $seo_key $page_meta_desc {\n';
    descripcionesConf += '    default "Kevin\\\'s Joyeros es una joyería colombiana que ofrece una amplia variedad de joyas de alta calidad, incluyendo anillos, pulseras, collares y aretes. Descubre nuestras colecciones exclusivas y encuentra la joya perfecta para cada ocasión.";\n';
    
    registrosAExportar.forEach(r => {
      if (r.descripcion) {
        const llave = this.extraerLlaveDeUrl(r.link);
        const descSegura = this.escaparTextoNginx(r.descripcion);
        descripcionesConf += `    "${llave}" "${descSegura}";\n`;
      }
    });
    descripcionesConf += '}\n';

    const descargarArchivo = (contenido: string, nombreArchivo: string) => {
      const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const ts = new Date().toLocaleString();

    descargarArchivo(titulosConf, `titulos-${ts}.conf`);
    descargarArchivo(descripcionesConf, `descripciones-${ts}.conf`);

    this.mostrarMensaje(`2 archivos .conf exportados (${registrosAExportar.length} registros)`);
  }

  // =====================================================================

  private crearPayload() {
    const v = this.form.getRawValue();
    return {
      titulo: (v.titulo ?? '').toString().trim(),
      descripcion: (v.descripcion ?? '').toString().trim(),
      keywords: (v.keywords ?? '').toString().trim(),
      link: this.normalizarKevinsUrl((v.linkActual ?? '').toString().trim())
    };
  }

  private mostrarMensaje(msg: string) {
    this.mensajeError = '';
    this.mensajeEnvio = msg;
    setTimeout(() => this.mensajeEnvio = '', 3500);
  }

  private mostrarError(msg: string) {
    this.mensajeEnvio = '';
    this.mensajeError = msg;
    setTimeout(() => this.mensajeError = '', 4000);
  }
}