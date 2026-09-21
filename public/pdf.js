/* Local PDF export. No calls to Apps Script except reading the selected cases/evidence. */
(function(root){
  'use strict';
  const D=root.ArdepeDomain;
  async function generate(cases,evidence,now=new Date().toISOString(),logoBytes) {
    const {PDFDocument,StandardFonts,rgb,PDFName,PDFString}=root.PDFLib;
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.setTitle('ARDEPE - Informe de atenciones');pdf.setAuthor('Central Integral de Monitoreo ARDEPE');pdf.setCreationDate(new Date(now));
    const logo=logoBytes?await pdf.embedPng(logoBytes):null;
    const width=595.28,height=841.89,margin=44,available=width-margin*2;
    let page,y;
    const format=value=>value?new Date(value).toLocaleString('es-PE',{timeZone:'America/Lima'}):'No registrado';
    // Standard PDF fonts support Spanish/WinAnsi. Unsupported symbols receive a visible replacement.
    const clean=value=>Array.from(String(value??'').normalize('NFC')).map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');
    function newPage(){page=pdf.addPage([width,height]);y=height-42;if(logo){const scale=Math.min(108/logo.width,42/logo.height);page.drawImage(logo,{x:margin,y:y-logo.height*scale+5,width:logo.width*scale,height:logo.height*scale});}page.drawText('ARDEPE S.A.C.',{x:logo?margin+122:margin,y,font:bold,size:11,color:rgb(.65,.18,.15)});page.drawText('Informe de atenciones · Central Integral de Monitoreo',{x:logo?margin+122:margin,y:y-15,font,size:9,color:rgb(.25,.31,.36)});page.drawText('Generado: '+format(now),{x:logo?margin+122:margin,y:y-29,font,size:8,color:rgb(.4,.4,.4)});y-=58;page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:1,color:rgb(.65,.18,.15)});y-=18;}
    function space(amount){if(!page||y-amount<48)newPage();}
    function text(value,{size=10,strong=false,color=rgb(.15,.19,.23),gap=5,link}={}){
      const f=strong?bold:font,lines=[];
      for(const paragraph of clean(value).split('\n')){
        let line='';
        for(const word of paragraph.split(/\s+/)){
          if(line && f.widthOfTextAtSize(line+' '+word,size)>available){lines.push(line);line='';}
          for(const char of (line?' ':'')+word){if(f.widthOfTextAtSize(line+char,size)>available){lines.push(line);line='';}line+=char;}
        }
        lines.push(line);
      }
      for(const line of lines){space(size+5);page.drawText(line,{x:margin,y,font:f,size,color});
        if(link){const annotation=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[margin,y-2,margin+f.widthOfTextAtSize(line,size),y+size],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(link)}});let annotations=page.node.lookupMaybe(PDFName.of('Annots'),root.PDFLib.PDFArray);if(!annotations){annotations=pdf.context.obj([]);page.node.set(PDFName.of('Annots'),annotations);}annotations.push(pdf.context.register(annotation));}
        y-=size+5;
      }y-=gap;
    }
    function heading(value){space(55);y-=8;text(value,{strong:true,size:12});}
    for(let index=0;index<cases.length;index++){
      const c=cases[index];newPage();
      text('Atención '+(index+1)+' de '+cases.length+' - Exportado: '+format(now),{size:9});
      text(c.title,{size:17,strong:true});
      text(D.STATES[c.status]+' / '+(c.result||'Resultado pendiente'),{strong:true});
      text('Origen: '+({GEOTAB:'Alerta Geotab',CENTRAL:'Solicitud de Central',CONDUCTOR:'Reporte del conductor'}[c.origin]||c.origin)+' | Prioridad: '+c.priority);
      text('Vehículo: '+(c.plate||'Por confirmar')+' | Conductor: '+(c.driverName||'Por confirmar'));
      text('Evento: '+format(c.occurredAt)+' | Creación: '+format(c.createdAt));
      text('Inicio de atención: '+format(c.startedAt)+' | Finalización: '+format(c.finalizedAt));
      text('Primera respuesta: '+format(c.firstResponseAt));
      text('Operador: '+(c.operator?c.operator.name+' / '+c.operator.area:'Sin asignar'));
      text('Ubicación: '+(c.location||'No disponible'));
      text('Valor detectado: '+(c.measurement?c.measurement.text:'No aplica'));
      text('Descripción: '+c.description);
      if(c.damages)text('Daños: '+c.damages);if(c.affected)text('Personas afectadas: '+c.affected);
      heading('Tiempos al exportar');
      const t=D.times(c,now);
      text('Total: '+D.elapsed(t.total)+' | Hasta inicio: '+D.elapsed(t.toStart));
      text('Espera del conductor: '+D.elapsed(t.waiting)+' | Seguimiento: '+D.elapsed(t.followUp));
      if((c.events||[]).length){heading('Eventos asociados');for(const e of c.events)text(e.title+' | '+format(e.occurredAt)+' | '+(e.measurement?e.measurement.text:'Valor no disponible'));}
      heading('Gestiones');
      if(!c.managements.length)text('Sin gestiones registradas.');
      for(const m of c.managements){text('Fecha y hora de gestión: '+format(m.at)+' / '+m.person.name+' / '+m.person.area,{strong:true});for(const [label,key] of [['Resultado','result'],['Causa','cause'],['Canal de atención','channel'],['Tipo de acción','action'],['Acción realizada','immediateAction'],['Detalle adicional de acción','correctiveAction'],['Responsable de seguimiento','owner'],['Fecha límite de seguimiento','dueDate'],['Resumen y observaciones','summary'],['Observación complementaria','notes'],['Estado registrado','status']])if(m[key])text(label+': '+(key==='channel'&&m[key]==='Drive'?'Geotab Drive':key==='status'?(D.STATES[m[key]]||m[key]):m[key]));if(m.status==='FINALIZADA')text('Fecha y hora de cierre: '+format(c.finalizedAt||m.at));}
      heading('Conversación y evidencias');
      if(!c.messages.length)text('Sin mensajes registrados.');
      for(const m of c.messages){space(55);text(m.author+' / '+(m.role==='central'?'Monitoreo':'Conductor')+' / '+format(m.at),{strong:true});text(m.text);if(m.requiresResponse)text('Solicita respuesta del conductor',{size:9});
        for(const file of c.attachments.filter(a=>a.messageId===m.id)){
          text('Adjunto: '+file.name+' ('+file.size+' bytes)',{size:9});
          if(file.mimeType.startsWith('image/')){
            let data=await evidence(file),image;
            if(file.mimeType==='image/webp'){
              const bitmap=await createImageBitmap(await (await fetch(data)).blob()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();data=canvas.toDataURL('image/png');
            }
            image=file.mimeType==='image/jpeg'?await pdf.embedJpg(data):await pdf.embedPng(data);
            const scale=Math.min(available/image.width,260/image.height,1),w=image.width*scale,h=image.height*scale;
            space(h+12);page.drawImage(image,{x:margin,y:y-h,width:w,height:h});y-=h+14;
          }else if(file.fileId)text('Abrir documento privado en Drive',{size:9,link:'https://drive.google.com/file/d/'+encodeURIComponent(file.fileId)+'/view',color:rgb(.12,.35,.55)});
          else text('Documento de demostración: disponible desde el caso en este navegador.',{size:9});
        }
      }
    }
    const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText('ARDEPE - '+(i+1)+' / '+pages.length,{x:margin,y:25,font,size:9,color:rgb(.4,.4,.4)}));
    return pdf.save();
  }
  root.ArdepePDF={generate};
})(typeof window==='undefined'?globalThis:window);
