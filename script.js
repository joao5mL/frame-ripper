const $ = id => document.getElementById(id);

const videoInput = $('videoInput');
const dropZone = $('dropZone');
const video = $('videoPreview');
const controls = $('controls');
const videoInfo = $('videoInfo');
const mode = $('mode');
const valueInput = $('valueInput');
const valueLabel = $('valueLabel');
const quality = $('quality');
const startInput = $('startInput');
const endInput = $('endInput');
const estimate = $('estimate');
const extractBtn = $('extractBtn');
const cancelBtn = $('cancelBtn');
const progressBox = $('progressBox');
const barFill = $('barFill');
const progressText = $('progressText');
const progressCount = $('progressCount');
const progressNote = $('progressNote');
const gallery = $('gallery');
const frameGrid = $('frameGrid');
const frameCount = $('frameCount');
const downloadAll = $('downloadAll');
const clearBtn = $('clearBtn');
const zipStatus = $('zipStatus');

let videoFile = null;
let videoUrl = null;
let frames = [];
let extractionRun = 0;
let wakeLock = null;
let nextIndex = 0;
let planKey = '';
let extracting = false;

const DOWNLOAD_ICON = `
<svg viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2"
stroke-linecap="round" stroke-linejoin="round">
<path d="M12 4v11"/>
<path d="m7.5 11 4.5 4.5 4.5-4.5"/>
<path d="M5 20h14"/>
</svg>
`;

const CHECK_ICON = `
<svg viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2.4"
stroke-linecap="round" stroke-linejoin="round">
<path d="m5 12.5 4.5 4.5L19 7.5"/>
</svg>
`;

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function numberFrom(input) {
  return parseFloat(
    String(input.value).replace(',', '.')
  );
}

function formatBytes(bytes) {
  if (bytes < 1048576) {
    return Math.max(
      1,
      Math.round(bytes / 1024)
    ) + ' KB';
  }

  return (bytes / 1048576).toFixed(1) + ' MB';
}

function buildTimes(duration) {
  let start = numberFrom(startInput);
  let end = numberFrom(endInput);

  if (!(start >= 0)) {
    start = 0;
  }

  if (!(end > 0) || end > duration) {
    end = duration;
  }

  if (start >= end) {
    return {
      error: 'O início precisa ser menor que o fim.'
    };
  }

  const times = [];

  if (mode.value === 'interval') {
    let interval = numberFrom(valueInput);

    if (!(interval > 0)) {
      interval = 0.5;
    }

    for (
      let time = start;
      time < end - 0.000001;
      time += interval
    ) {
      times.push(
        Math.min(time, end - 0.01)
      );
    }
  }

  else if (mode.value === 'total') {
    const total = Math.max(
      1,
      parseInt(valueInput.value) || 20
    );

    for (let index = 0; index < total; index++) {
      times.push(
        start + ((end - start) * index) / total
      );
    }
  }

  else {
    for (
      let time = start;
      time < end - 0.000001;
      time += 1 / 30
    ) {
      times.push(time);
    }
  }

  return {
    times
  };
}

function getPlanKey(times) {
  return [
    mode.value,
    valueInput.value,
    startInput.value,
    endInput.value,
    quality.value,
    times.length,
    times[0],
    times[times.length - 1]
  ].join('|');
}

function updateEstimate() {
  if (!video.duration || isNaN(video.duration)) {
    estimate.classList.add('hidden');
    return;
  }

  const result = buildTimes(video.duration);

  estimate.classList.remove('hidden');

  if (result.error) {
    estimate.classList.add('warn');
    estimate.textContent = result.error;
    return;
  }

  estimate.classList.remove('warn');

  const factor =
    quality.value === 'png' ? 1.4 : 0.18;

  const estimatedBytes =
    result.times.length *
    (video.videoWidth || 1280) *
    (video.videoHeight || 720) *
    factor;

  estimate.textContent =
    `Serão extraídos aproximadamente ` +
    `${result.times.length} frames. ` +
    `A resolução será ${video.videoWidth} × ` +
    `${video.videoHeight} pixels. ` +
    `Tamanho estimado: ${formatBytes(estimatedBytes)}.`;
}

[
  valueInput,
  startInput,
  endInput,
  quality
].forEach(input => {
  input.addEventListener(
    'input',
    updateEstimate
  );
});

video.addEventListener(
  'loadedmetadata',
  () => {
    updateEstimate();

    videoInfo.textContent =
      `${video.videoWidth} × ${video.videoHeight} pixels • ` +
      `${video.duration.toFixed(2)} segundos`;
  }
);

mode.addEventListener('change', () => {
  valueInput.disabled = mode.value === 'all';

  if (mode.value === 'interval') {
    valueLabel.textContent =
      'Intervalo entre frames em segundos';

    valueInput.value = '0.5';
    valueInput.step = '0.01';
  }

  if (mode.value === 'total') {
    valueLabel.textContent =
      'Quantidade total de frames';

    valueInput.value = '20';
    valueInput.step = '1';
  }

  if (mode.value === 'all') {
    valueLabel.textContent =
      'Todos os frames a 30 fps';

    valueInput.value = '';
  }

  updateEstimate();
});

function lockScreen(active) {
  if (!('wakeLock' in navigator)) {
    return;
  }

  if (active) {
    navigator.wakeLock
      .request('screen')
      .then(lock => {
        wakeLock = lock;
      })
      .catch(() => {});
  }

  else if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function seekTo(time) {
  return new Promise(resolve => {
    let finished = false;

    const finish = success => {
      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);

      video.removeEventListener(
        'seeked',
        onSeeked
      );

      resolve(success);
    };

    const onSeeked = () => {
      finish(true);
    };

    const timeout = setTimeout(() => {
      finish(false);
    }, 1800);

    video.addEventListener(
      'seeked',
      onSeeked,
      {
        once: true
      }
    );

    try {
      video.currentTime = time;
    } catch (error) {
      finish(false);
    }
  });
}

function canvasToBlob(canvas, type, qualityValue) {
  return new Promise(resolve => {
    canvas.toBlob(
      resolve,
      type,
      qualityValue
    );
  });
}

function downloadBlob(blob, filename) {
  if (!blob) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30000);
}

function clearFrames() {
  frames.forEach(frame => {
    if (frame.previewUrl) {
      URL.revokeObjectURL(frame.previewUrl);
    }
  });

  frames = [];
  nextIndex = 0;
  planKey = '';

  frameGrid.innerHTML = '';
  frameCount.textContent = '0 frames';
}

function renderGallery() {
  frameGrid.innerHTML = '';

  frames.forEach(frame => {
    addFrameCard(frame);
  });

  frameCount.textContent =
    `${frames.length} frames`;

  gallery.classList.toggle(
    'hidden',
    frames.length === 0
  );
}

function resetInterface() {
  controls.classList.add('hidden');
  dropZone.classList.remove('hidden');
  gallery.classList.add('hidden');
  progressBox.classList.add('hidden');

  extractBtn.classList.remove('hidden');
  extractBtn.disabled = false;

  cancelBtn.classList.add('hidden');

  lockScreen(false);
}

function loadVideo(file) {
  if (
    !file ||
    !file.type.startsWith('video/')
  ) {
    return;
  }

  extractionRun++;
  clearFrames();

  videoFile = file;

  if (videoUrl) {
    URL.revokeObjectURL(videoUrl);
  }

  videoUrl = URL.createObjectURL(file);

  video.src = videoUrl;
  video.load();

  dropZone.classList.add('hidden');
  controls.classList.remove('hidden');
  gallery.classList.add('hidden');
}

dropZone.addEventListener('click', event => {
  if (!event.target.closest('label')) {
    videoInput.click();
  }
});

videoInput.addEventListener('change', () => {
  loadVideo(videoInput.files[0]);
});

dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragover');

  loadVideo(
    event.dataTransfer.files[0]
  );
});

$('removeVideoBtn').addEventListener(
  'click',
  () => {
    extractionRun++;

    video.pause();
    video.removeAttribute('src');
    video.load();

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    videoUrl = null;
    videoFile = null;
    videoInput.value = '';

    clearFrames();
    resetInterface();
  }
);

clearBtn.addEventListener(
  'click',
  () => {
    extractionRun++;
    clearFrames();

    gallery.classList.add('hidden');
    progressBox.classList.add('hidden');
  }
);

cancelBtn.addEventListener(
  'click',
  () => {
    if (!extracting) {
      return;
    }

    extractionRun++;
    extracting = false;

    video.pause();

    progressText.textContent =
      `Pausado. ${frames.length} frames ` +
      `prontos para visualização.`;

    progressNote.textContent =
      'A extração foi pausada. Você pode continuar depois; ' +
      'os frames já concluídos foram mantidos.';

    extractBtn.classList.remove('hidden');
    extractBtn.disabled = false;

    cancelBtn.classList.add('hidden');
    progressBox.classList.add('hidden');

    renderGallery();
    lockScreen(false);
  }
);
extractBtn.addEventListener(
  'click',
  async () => {
    if (
      !videoFile ||
      !video.videoWidth ||
      extracting
    ) {
      return;
    }

    const plan = buildTimes(video.duration);

    if (plan.error) {
      estimate.classList.remove('hidden');
      estimate.classList.add('warn');
      estimate.textContent = plan.error;
      return;
    }

    const currentPlanKey =
      getPlanKey(plan.times);

    if (
      planKey &&
      planKey !== currentPlanKey
    ) {
      clearFrames();
    }

    planKey = currentPlanKey;

    if (nextIndex >= plan.times.length) {
      progressBox.classList.remove('hidden');

      progressText.textContent =
        'Todos os frames deste trecho já foram extraídos.';

      progressCount.textContent =
        `${frames.length} / ${plan.times.length}`;

      renderGallery();
      return;
    }

    const currentRun = ++extractionRun;
    const times = plan.times;
    const width = video.videoWidth;
    const height = video.videoHeight;

    const isPng = quality.value === 'png';
    const extension = isPng ? 'png' : 'jpg';

    const jpgQuality =
      quality.value === 'jpg-high'
        ? 0.92
        : 0.8;

    const thumbnailWidth =
      Math.min(360, width);

    const thumbnailHeight = Math.max(
      1,
      Math.round(
        thumbnailWidth * height / width
      )
    );

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const thumbnailCanvas =
      document.createElement('canvas');

    thumbnailCanvas.width = thumbnailWidth;
    thumbnailCanvas.height = thumbnailHeight;

    const context = canvas.getContext(
      '2d',
      {
        alpha: false
      }
    );

    const thumbnailContext =
      thumbnailCanvas.getContext(
        '2d',
        {
          alpha: false
        }
      );

    extracting = true;

    gallery.classList.add('hidden');
    frameGrid.innerHTML = '';

    progressBox.classList.remove('hidden');

    extractBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    progressNote.classList.remove('hidden');

    progressNote.textContent =
      'A grade ficará oculta até terminar ou pausar, ' +
      'reduzindo o uso do celular.';

    video.controls = false;
    lockScreen(true);

    frameGrid.style.setProperty(
      '--ar',
      `${width}/${height}`
    );

    barFill.style.width =
      `${Math.round(
        nextIndex / times.length * 100
      )}%`;

    for (
      ;
      nextIndex < times.length &&
      currentRun === extractionRun;
      nextIndex++
    ) {
      let found = false;

      for (
        let attempt = 0;
        attempt < 2 && !found;
        attempt++
      ) {
        const safeTime = Math.min(
          times[nextIndex] + attempt * 0.002,
          Math.max(0, video.duration - 0.01)
        );

        found = await seekTo(safeTime);
      }

      if (!found) {
        continue;
      }

      context.drawImage(
        video,
        0,
        0,
        width,
        height
      );

      thumbnailContext.drawImage(
        video,
        0,
        0,
        thumbnailWidth,
        thumbnailHeight
      );

      const fullBlob = await canvasToBlob(
        canvas,
        isPng ? 'image/png' : 'image/jpeg',
        isPng ? undefined : jpgQuality
      );

      const thumbnailBlob = await canvasToBlob(
        thumbnailCanvas,
        'image/jpeg',
        0.62
      );

      if (
        !fullBlob ||
        !thumbnailBlob ||
        currentRun !== extractionRun
      ) {
        break;
      }

      const frameNumber =
        frames.length + 1;

      const frame = {
        number: frameNumber,

        time: times[nextIndex],

        name:
          `frame_${String(frameNumber).padStart(4, '0')}_` +
          `${times[nextIndex].toFixed(2)}s.` +
          extension,

        blob: fullBlob,

        previewUrl:
          URL.createObjectURL(thumbnailBlob)
      };

      frames.push(frame);

      const completed =
        nextIndex + 1;

      const percentage = Math.round(
        completed / times.length * 100
      );

      barFill.style.width =
        `${percentage}%`;

      progressText.textContent =
        `Extraindo frame ${completed} de ` +
        `${times.length} — ${percentage}%`;

      progressCount.textContent =
        `${completed} / ${times.length}`;

      if (nextIndex % 6 === 0) {
        await wait(0);
      }
    }

    if (currentRun !== extractionRun) {
      return;
    }

    extracting = false;
    video.controls = true;
    lockScreen(false);

    extractBtn.classList.remove('hidden');
    extractBtn.disabled = false;

    cancelBtn.classList.add('hidden');
    progressNote.classList.add('hidden');
    progressBox.classList.add('hidden');

    if (nextIndex >= times.length) {
      progressText.textContent =
        `Extração finalizada. ` +
        `${frames.length} frames criados.`;
    } else {
      progressText.textContent =
        `Pausado em ${frames.length} frames.`;
    }

    renderGallery();
  }
);


function addFrameCard(frame) {
  const card = document.createElement('div');

  card.className = 'frame-card';

  const image = document.createElement('img');

  image.src = frame.previewUrl;
  image.alt = `Frame ${frame.number}`;
  image.loading = 'lazy';
  image.decoding = 'async';

  const info = document.createElement('div');
  info.className = 'info';

  const details = document.createElement('div');

  const number = document.createElement('span');
  number.className = 'frame-number';
  number.textContent =
    `Frame ${frame.number}`;

  const time = document.createElement('span');
  time.className = 'frame-time';
  time.textContent =
    `${frame.time.toFixed(2)} segundos`;

  details.append(number, time);

  const button = document.createElement('button');

  button.className = 'download-icon';
  button.title =
    `Baixar frame ${frame.number}`;

  button.setAttribute(
    'aria-label',
    `Baixar frame ${frame.number}`
  );

  button.innerHTML = DOWNLOAD_ICON;

  button.addEventListener(
    'click',
    () => {
      downloadBlob(
        frame.blob,
        frame.name
      );

      button.innerHTML = CHECK_ICON;

      setTimeout(() => {
        button.innerHTML = DOWNLOAD_ICON;
      }, 1000);
    }
  );

  info.append(details, button);
  card.append(image, info);
  frameGrid.appendChild(card);
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (
    let number = 0;
    number < 256;
    number++
  ) {
    let value = number;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }

    table[number] = value >>> 0;
  }

  return table;
})();


async function createZip(items) {
  const encoder = new TextEncoder();

  const localParts = [];
  const centralParts = [];

  let offset = 0;
  let centralSize = 0;
  let count = 0;

  const date = new Date();

  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1);

  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  for (const item of items) {
    const data = new Uint8Array(
      await item.blob.arrayBuffer()
    );

    const name = encoder.encode(item.name);

    let crc = 0xffffffff;

    for (const byte of data) {
      crc =
        CRC_TABLE[(crc ^ byte) & 255] ^
        (crc >>> 8);
    }

    crc = (crc ^ 0xffffffff) >>> 0;

    const localHeader = new DataView(
      new ArrayBuffer(30)
    );

    localHeader.setUint32(
      0,
      0x04034b50,
      true
    );

    localHeader.setUint16(4, 20, true);
    localHeader.setUint16(6, 0x0800, true);
    localHeader.setUint16(8, 0, true);
    localHeader.setUint16(10, dosTime, true);
    localHeader.setUint16(12, dosDate, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, data.length, true);
    localHeader.setUint32(22, data.length, true);
    localHeader.setUint16(26, name.length, true);
    localHeader.setUint16(28, 0, true);

    localParts.push(
      localHeader.buffer,
      name,
      data
    );

    const centralHeader = new DataView(
      new ArrayBuffer(46)
    );

    centralHeader.setUint32(
      0,
      0x02014b50,
      true
    );

    centralHeader.setUint16(4, 20, true);
    centralHeader.setUint16(6, 20, true);
    centralHeader.setUint16(8, 0x0800, true);
    centralHeader.setUint16(10, 0, true);
    centralHeader.setUint16(12, dosTime, true);
    centralHeader.setUint16(14, dosDate, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, data.length, true);
    centralHeader.setUint32(24, data.length, true);
    centralHeader.setUint16(28, name.length, true);
    centralHeader.setUint16(30, 0, true);
    centralHeader.setUint16(32, 0, true);
    centralHeader.setUint16(34, 0, true);
    centralHeader.setUint16(36, 0, true);
    centralHeader.setUint32(38, 0, true);
    centralHeader.setUint32(42, offset, true);

    centralParts.push(
      centralHeader.buffer,
      name
    );

    offset +=
      30 +
      name.length +
      data.length;

    centralSize +=
      46 +
      name.length;

    count++;
  }

  const endRecord = new DataView(
    new ArrayBuffer(22)
  );

  endRecord.setUint32(
    0,
    0x06054b50,
    true
  );

  endRecord.setUint16(4, 0, true);
  endRecord.setUint16(6, 0, true);
  endRecord.setUint16(8, count, true);
  endRecord.setUint16(10, count, true);
  endRecord.setUint32(12, centralSize, true);
  endRecord.setUint32(16, offset, true);
  endRecord.setUint16(20, 0, true);

  return new Blob(
    [
      ...localParts,
      ...centralParts,
      endRecord.buffer
    ],
    {
      type: 'application/zip'
    }
  );
}


downloadAll.addEventListener(
  'click',
  async () => {
    if (!frames.length) {
      return;
    }

    downloadAll.disabled = true;

    zipStatus.classList.remove('hidden');

    zipStatus.textContent =
      `Preparando ZIP com ${frames.length} frames…`;

    try {
      const zip = await createZip(frames);

      downloadBlob(
        zip,
        `frames_${Date.now()}.zip`
      );

      zipStatus.textContent =
        `ZIP criado com ${frames.length} frames.`;
    } catch (error) {
      zipStatus.textContent =
        'Não foi possível criar o ZIP.';
    }

    downloadAll.disabled = false;
  }
);


/* Tela de abertura */

(function startSplash() {
  const splash = $('splash');
  const fill = $('splashFill');
  const title = $('splashTitle');

  // espera a fonte do título carregar (no máximo 2s), ajusta o tamanho e só então mostra
  const titleFont = (document.fonts && document.fonts.load)
    ? Promise.race([
        document.fonts.load('800 40px Syne').catch(() => {}),
        new Promise(resolve => {
          setTimeout(resolve, 2000);
        })
      ])
    : Promise.resolve();

  titleFont.then(() => {
    fitTitles();
    title.classList.add('ready');
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.width = '100%';
    });
  });

  const minimumTime = new Promise(resolve => {
    setTimeout(resolve, 1300);
  });

  const fontsReady = document.fonts
    ? Promise.race([
        document.fonts.ready,
        new Promise(resolve => {
          setTimeout(resolve, 2000);
        })
      ])
    : Promise.resolve();

  Promise.all([
    minimumTime,
    fontsReady,
    titleFont
  ]).then(() => {
    splash.classList.add('leaving');

    document.body.classList.remove(
      'splash-active'
    );

    setTimeout(() => {
      splash.remove();
    }, 500);
  });
})();


function fitTitles() {
  // largura real da página (innerWidth pode vir errada em alguns WebViews)
  const viewWidth =
    document.documentElement.clientWidth ||
    window.innerWidth;

  const availableWidth = viewWidth - 56;

  document.querySelectorAll('.fit, #splashTitle').forEach(element => {
    const maximum = Number(
      element.dataset.max ||
      (element.id === 'splashTitle' ? 44 : 40)
    );

    element.style.fontSize = `${maximum}px`;

    const textWidth = element.scrollWidth;

    if (textWidth > availableWidth) {
      element.style.fontSize =
        `${Math.max(
          20,
          Math.floor(
            maximum * availableWidth / textWidth
          )
        )}px`;
    }
  });
}

fitTitles();

// refaz o ajuste quando a fonte termina de carregar (antes ele media com a fonte reserva, mais estreita)
if (document.fonts) {
  if (document.fonts.ready) {
    document.fonts.ready.then(fitTitles);
  }

  if (document.fonts.addEventListener) {
    document.fonts.addEventListener(
      'loadingdone',
      fitTitles
    );
  }
}

window.addEventListener('load', fitTitles);
window.addEventListener('resize', fitTitles);

window.addEventListener('orientationchange', () => {
  setTimeout(fitTitles, 200);
});
