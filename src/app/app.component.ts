import {
  Component,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  OnInit,
  HostListener
} from '@angular/core';
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

  iframeUrl = 'http://localhost:3001/kevins';
  iframeSafeUrl: SafeResourceUrl;

  iframeLoaded = false;
  mensajeEnvio = '';
  mensajeError = '';

  private allowedIframeOrigin = 'http://localhost:3001';
  private originalOrigin = 'https://kevins.com.co';

  // Array donde se guardan los registros acumulados
  registrosGuardados: any[] = [];
  textoBusqueda: string = '';

  get registrosFiltrados() {
    // Si el buscador está vacío, NO mostramos nada
    if (!this.textoBusqueda || this.textoBusqueda.trim() === '') {
      return [];
    }
    
    // Si hay texto, filtramos y mostramos las coincidencias
    const texto = this.textoBusqueda.toLowerCase();
    return this.registrosGuardados.filter(registro => 
      (registro.titulo && registro.titulo.toLowerCase().includes(texto)) ||
      (registro.descripcion && registro.descripcion.toLowerCase().includes(texto)) ||
      (registro.keywords && registro.keywords.toLowerCase().includes(texto)) ||
      (registro.link && registro.link.toLowerCase().includes(texto))
    );
  }


  constructor(
    private fb: FormBuilder,
    private sanitizer: DomSanitizer
  ) {
    this.form = this.fb.group({
      titulo: ['', Validators.required],
      descripcion: ['', Validators.required],
      keywords: [''], 
      linkActual: ['Navega por Kevins para capturar links...']
    });

    this.iframeSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.iframeUrl);
  }

  ngOnInit() {
    // 1. CARGAR DATOS PREVIOS AL INICIAR LA PÁGINA
    
    // Cargar la lista de registros acumulados
    const registrosGuardadosLocal = localStorage.getItem('kevins_registros');
    if (registrosGuardadosLocal) {
      this.registrosGuardados = JSON.parse(registrosGuardadosLocal);
    }

    // Cargar lo que el usuario estaba escribiendo en el formulario
    const formGuardadoLocal = localStorage.getItem('kevins_formulario_actual');
    if (formGuardadoLocal) {
      this.form.patchValue(JSON.parse(formGuardadoLocal), { emitEvent: false });
    }

    // 2. GUARDAR EL FORMULARIO AUTOMÁTICAMENTE MIENTRAS SE ESCRIBE Y MANEJAR VALIDACIONES
    this.form.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(values => {
        // Guardar en localStorage temporal
        localStorage.setItem('kevins_formulario_actual', JSON.stringify(values));

        // 👇 NUEVA LÓGICA: Validación condicional
        const tituloControl = this.form.get('titulo');
        const descControl = this.form.get('descripcion');
        const keywordsValue = values.keywords ? values.keywords.trim() : '';

        if (keywordsValue.length > 0) {
          // Si hay keywords, quitamos la obligación de título y descripción
          tituloControl?.clearValidators();
          descControl?.clearValidators();
        } else {
          // Si NO hay keywords, título y descripción vuelven a ser obligatorios
          tituloControl?.setValidators([Validators.required]);
          descControl?.setValidators([Validators.required]);
        }

        // Aplicamos los cambios de validación sin disparar un loop infinito
        tituloControl?.updateValueAndValidity({ emitEvent: false });
        descControl?.updateValueAndValidity({ emitEvent: false });
      });
      
      // Forzar la validación inicial por si había datos cargados del localStorage
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
             keywords: '',
             linkActual: linkLimpio
          }, { emitEvent: true }); // Emitimos evento para que guarde en LocalStorage
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
             keywords: '',
             linkActual: linkLimpio
          }, { emitEvent: true }); // Emitimos evento para que guarde en LocalStorage
       }
       return;
    }
  }

  enviarFormulario() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.mostrarError('⚠️ Por favor completa los campos obligatorios.');
      return;
    }

    const payload = this.crearPayload();

    // Buscar si ya existe un registro con el mismo link
    const indexExistente = this.registrosGuardados.findIndex(r => r.link === payload.link);

    if (indexExistente !== -1) {
      // El link ya existe: actualizamos solo los campos que venían vacíos en el registro
      const registroExistente = this.registrosGuardados[indexExistente];

      const huboActualizacion =
        (!registroExistente.titulo    && payload.titulo)    ||
        (!registroExistente.descripcion && payload.descripcion) ||
        (!registroExistente.keywords  && payload.keywords);

      if (!huboActualizacion) {
        // Todos los campos ya tenían datos: no permitir duplicado
        this.mostrarError('⚠️ Ya existe un registro completo para este link.');
        return;
      }

      // Actualizar solo los campos que estaban vacíos
      if (!registroExistente.titulo    && payload.titulo)    registroExistente.titulo = payload.titulo;
      if (!registroExistente.descripcion && payload.descripcion) registroExistente.descripcion = payload.descripcion;
      if (!registroExistente.keywords  && payload.keywords)  registroExistente.keywords = payload.keywords;

      // Guardar en localStorage el arreglo actualizado
      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`✅ Registro actualizado (Total: ${this.registrosGuardados.length})`);

    } else {
      // El link NO existe: agregar como nuevo registro
      this.registrosGuardados.push(payload);
      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`✅ Guardado en la lista (Total: ${this.registrosGuardados.length})`);
    }

    // Limpiar formulario pero mantener el link actual
    const linkActual = this.form.get('linkActual')?.value;
    this.form.reset({
      titulo: '',
      descripcion: '',
      keywords: '',
      linkActual: linkActual
    });
  }

    exportarJson() {
    // 1. CLONAMOS LA LISTA ACTUAL PARA NO MODIFICAR LA ORIGINAL
    const registrosAExportar = [...this.registrosGuardados];

    // 2. SI HAY UN FORMULARIO VÁLIDO A MEDIO ESCRIBIR, LO INCLUIMOS TEMPORALMENTE EN LA EXPORTACIÓN 
    // PERO NO LO BORRAMOS VISUALMENTE NI LO METEMOS EN LA LISTA OFICIAL
    if (this.form.valid && (this.form.value.titulo || this.form.value.descripcion || this.form.value.keywords)) {
      registrosAExportar.push(this.crearPayload());
    }

    if (registrosAExportar.length === 0) {
      this.mostrarError('⚠️ No hay ningún registro guardado para exportar.');
      return;
    }

    // 3. DIVIDIR LOS DATOS EN 3 ARREGLOS DISTINTOS USANDO LA COPIA
    const dataTitulos = registrosAExportar.map(r => ({ titulo: r.titulo, link: r.link }));
    const dataDescripciones = registrosAExportar.map(r => ({ descripcion: r.descripcion, link: r.link }));
    const dataKeywords = registrosAExportar.map(r => ({ keywords: r.keywords, link: r.link }));

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // 4. FUNCIÓN AUXILIAR PARA DESCARGAR UN ARCHIVO
    const descargarArchivo = (data: any[], nombreArchivo: string) => {
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // 5. DESCARGAR LOS 3 ARCHIVOS SIMULTÁNEAMENTE
    descargarArchivo(dataTitulos, `titulos-${ts}.json`);
    descargarArchivo(dataDescripciones, `descripciones-${ts}.json`);
    descargarArchivo(dataKeywords, `keywords-${ts}.json`);

    this.mostrarMensaje(`✅ 3 archivos exportados (${registrosAExportar.length} registros)`);

    // ⚠️ YA NO LIMPIAMOS NADA: 
    // - El formulario mantiene lo que escribiste
    // - La lista de localStorage se mantiene intacta
  }

  eliminarRegistro(registroAEliminar: any) {
    const indexReal = this.registrosGuardados.findIndex(r => r === registroAEliminar);
    if (indexReal !== -1) {
      this.registrosGuardados.splice(indexReal, 1);
      localStorage.setItem('kevins_registros', JSON.stringify(this.registrosGuardados));
      this.mostrarMensaje(`🗑️ Registro eliminado (Quedan: ${this.registrosGuardados.length})`);
    }
  }


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
    setTimeout(() => (this.mensajeEnvio = ''), 3500);
  }

  private mostrarError(msg: string) {
    this.mensajeEnvio = ''; 
    this.mensajeError = msg;
    setTimeout(() => (this.mensajeError = ''), 4000);
  }
}