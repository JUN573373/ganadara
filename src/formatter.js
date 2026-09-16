/**
 * 발주 데이터 정제 및 변환 모듈 (formatter.js)
 */
import { DEFAULT_CONFIG } from './config.js';

/**
 * 부케 상품명에서 등급/코드 추출
 * 사용자 정의 변환 규칙(customRules)을 우선 적용합니다.
 */
export function cleanBouquetName(rawName, customRules = null) {
  if (!rawName) return '';
  let str = String(rawName).replace('수임료차감포함', '').trim();
  const strCompact = str.replace(/\s+/g, '');

  const rules = Array.isArray(customRules) && customRules.length > 0
    ? customRules
    : DEFAULT_CONFIG.bouquetRules;

  // 1. 사용자 커스텀 규칙 매칭
  for (const rule of rules) {
    if (!rule.pattern) continue;
    const pat = rule.pattern.trim();
    const patCompact = pat.replace(/\s+/g, '');

    // 공백 및 대소문자 무시 매칭
    const matched = strCompact.toLowerCase().includes(patCompact.toLowerCase()) ||
                    str.toLowerCase().includes(pat.toLowerCase());

    if (matched) {
      if (rule.replacement === '$CODE') {
        // 코드 패턴 자동 유지 ($CODE)
        if (pat.toUpperCase().startsWith('BL')) {
          const m = str.match(/(BL-?\d+)/i);
          if (m) {
            const c = m[1].toUpperCase();
            return c.startsWith('BL-') ? c : c.replace('BL', 'BL-');
          }
        }
        if (pat.toUpperCase().startsWith('S-')) {
          const m = str.match(/(S-\d+)/i);
          if (m) return m[1].toUpperCase();
        }
        if (pat.toUpperCase().startsWith('VVS')) {
          const m = str.match(/(VVS(?:-\d+)?)/i);
          if (m) return m[1].toUpperCase();
        }
      } else {
        // VVS 뒤에 번호가 있으면 유지 (예: VVS-6)
        if (rule.replacement === 'VVS') {
          const vvsMatch = str.match(/VVS(?:-|\s*)(\d+)/i);
          if (vvsMatch && vvsMatch[1]) {
            return `VVS-${vvsMatch[1]}`;
          }
        }
        // 숫자 코드가 붙어있는지 확인 (예: VS+512)
        if (rule.replacement === 'VS+') {
          const numMatch = str.match(/VS(?:\+|플러스)\s*(\d+)/i);
          if (numMatch && numMatch[1]) {
            return `VS+${numMatch[1]}`;
          }
        }
        // 촬영 부케류에서 S 등급 또는 금액 우선 (예: 'S', 8만원, 80,000원 -> 8만원)
        if (rule.replacement === '촬영 부케') {
          if (/\bS\b/i.test(str)) return 'S';
          const wonM = str.match(/(\d+)0,000원/);
          if (wonM) return `${wonM[1]}만원`;
          const priceM = str.match(/(\d+만원)/);
          if (priceM) return priceM[1];
        }
        return rule.replacement;
      }
    }
  }

  // 2. 기본 내장 추출 규칙 (규칙에 걸리지 않은 경우)

  // BL-코드 (BL-15, BL-1228 등)
  const blMatch = str.match(/\b(BL-?\d+)\b/i);
  if (blMatch) {
    const code = blMatch[1].toUpperCase();
    return code.startsWith('BL-') ? code : code.replace('BL', 'BL-');
  }

  // VS+ / VS플러스
  if (/VS\s*플러스/i.test(str) || /VS\+/i.test(str)) {
    const numMatch = str.match(/VS(?:\+|플러스)\s*(\d+)/i);
    if (numMatch && numMatch[1]) {
      return `VS+${numMatch[1]}`;
    }
    return 'VS+';
  }

  // VVS 계열
  const vvsMatch = str.match(/\b(VVS(?:-\d+)?)\b/i);
  if (vvsMatch) {
    return vvsMatch[1].toUpperCase();
  }

  // VS 계열
  const vsMatch = str.match(/\b(VS(?:-\d+)?)\b/i);
  if (vsMatch && !/VS(?:\+|플러스)/i.test(str)) {
    return vsMatch[1].toUpperCase();
  }

  // S-코드 (S-303, S-313 등)
  const sCodeMatch = str.match(/\b(S-\d+)\b/i);
  if (sCodeMatch) {
    return sCodeMatch[1].toUpperCase();
  }

  // 촬영 부케류
  if (str.includes('촬영부케') || str.includes('촬영 부케')) {
    if (/\bS\b/i.test(str)) return 'S';
    const priceM = str.match(/(\d+만원)/);
    if (priceM) return priceM[1];
    return '촬영 부케';
  }

  // S 단독 등급 (예: "[서비스 본식부케] S")
  if (/\bS\b/i.test(str) || /\]\s*S\b/i.test(str)) {
    return 'S';
  }

  // 추가금/금액 표기 (예: "[본식추가] 10만원", "80,000원")
  const wonMatch = str.match(/(\d+)0,000원/);
  if (wonMatch) {
    const manwon = `${wonMatch[1]}만원`;
    return str.includes('추가') ? `[추가] ${manwon}` : manwon;
  }
  const priceMatch = str.match(/(\d+만원)/);
  if (priceMatch) {
    if (str.includes('추가')) return `[추가] ${priceMatch[1]}`;
    return priceMatch[1];
  }

  // 앞의 괄호 태그 제거 및 금액/하이픈 안전 제거
  let clean = str.replace(/^\[[^\]]+\]\s*/, '').trim();
  clean = clean.replace(/\s*-\s*[\d,]+원?/g, '').trim();
  return clean || str;
}

/**
 * 특이사항/메모에서 아웃 시간 추출 (예: "11시 30분 아웃")
 */
export function extractOutTime(text) {
  if (!text) return '';
  const match = text.match(/(?:(\d{1,2})시(?:\s*(\d{1,2})분)?|(\d{1,2}):(\d{2}))\s*아웃/);
  if (!match) return '';

  let hour = match[1] || match[3];
  let min = match[2] || match[4] || '';

  if (min && min !== '0' && min !== '00') {
    return `${parseInt(hour, 10)}시 ${parseInt(min, 10)}분 아웃`;
  }
  return `${parseInt(hour, 10)}시 아웃`;
}

/**
 * 특이사항 텍스트 표준화 (아웃 시간이 감지되면 앞단에 배치)
 */
export function formatNotes(notes, venueTime = '') {
  let text = (notes || '').trim();
  const outTime = extractOutTime(text);

  if (outTime) {
    if (!text.startsWith(outTime)) {
      let stripped = text.replace(new RegExp(outTime, 'g'), '').trim();
      stripped = stripped.replace(/^[\s/,-]+|[\s/,-]+$/g, '').trim();
      return stripped ? `${outTime} / ${stripped}` : outTime;
    }
    return text;
  }

  return text;
}

/**
 * 신부명 정제 (신랑신부명이 같이 있는 경우 신부명 추출)
 */
export function cleanBrideName(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[0] || name;
}

/**
 * 배송지 정제: "(확인필요)" 문구를 텍스트에서 분리하여 반환
 */
export function cleanShippingPlace(rawPlace) {
  if (!rawPlace) return { place: '', needsCheck: false };
  const str = String(rawPlace).trim();
  const needsCheck = str.includes('확인필요');
  const cleanPlace = str.replace(/\(확인필요\)/g, '').replace(/확인필요/g, '').trim();
  return { place: cleanPlace, needsCheck };
}

/**
 * 주문 합산 함수
 * config 설정에 따라 On/Off 및 규칙이 적용됩니다.
 */
export function aggregateOrders(rawList, siteKey = 'ini', config = null) {
  const cfg = config || DEFAULT_CONFIG;
  const enableAgg = cfg.enableAggregation !== false;
  const enableOut = cfg.enableOutTime !== false;

  const groups = new Map();

  for (const item of rawList) {
    const planner = (item['담당플래너'] || '').trim();
    const bride = cleanBrideName(item['신부명']);
    const date = (item['날짜'] || item['예식일'] || '').trim();

    // 합산 미사용 시 행마다 고유 키 부여
    const key = enableAgg
      ? `${siteKey}_${date}_${planner}_${bride}`
      : `${siteKey}_${date}_${planner}_${bride}_${item['발주코드'] || Math.random()}`;

    // 배송지 확인필요 분리
    const rawShipping = item['배송지'] || '';
    const { place: cleanPlace, needsCheck } = cleanShippingPlace(rawShipping);

    if (!groups.has(key)) {
      groups.set(key, {
        ...item,
        _site: siteKey,
        _key: key,
        _isAggregated: false,
        _originalOrders: [item],
        // 배송지에서 '(확인필요)' 텍스트는 제외하고 순수 명칭만 저장
        배송지: cleanPlace,
        _needsCheck: needsCheck,
        // 사용자 코멘트 기본값
        myComment: item.myComment || '',
        sangwonComment: item.sangwonComment || '',
      });
    } else {
      const existing = groups.get(key);
      existing._isAggregated = true;
      existing._originalOrders.push(item);
      if (needsCheck) existing._needsCheck = true;

      // 발주부케 병합
      const currentBouquet = existing['발주부케'] || '';
      const newBouquet = item['발주부케'] || '';
      if (newBouquet && !currentBouquet.includes(newBouquet)) {
        existing['발주부케'] = `${currentBouquet} + ${newBouquet}`;
      }

      // 특이사항 병합
      const currentNotes = existing['특이사항(기타사항)'] || existing['특이사항'] || '';
      const newNotes = item['특이사항(기타사항)'] || item['특이사항'] || '';
      if (newNotes && !currentNotes.includes(newNotes)) {
        existing['특이사항'] = currentNotes ? `${currentNotes} / ${newNotes}` : newNotes;
        existing['특이사항(기타사항)'] = existing['특이사항'];
      }

      // 빈 필드 채우기
      if (!existing['배송지'] && cleanPlace) existing['배송지'] = cleanPlace;
      if (!existing['예식장소'] && item['예식장소']) existing['예식장소'] = item['예식장소'];
      if (!existing['예식시간'] && item['예식시간']) existing['예식시간'] = item['예식시간'];
    }
  }

  return Array.from(groups.values()).map((row) => {
    // 부케명 사용자 정의 변환 규칙 적용
    row._cleanedBouquet = cleanBouquetName(row['발주부케'], cfg.bouquetRules);

    // 특이사항 정제
    const rawNote = row['특이사항(기타사항)'] || row['특이사항'] || '';
    row['특이사항'] = enableOut ? formatNotes(rawNote, row['예식시간']) : rawNote;
    row['특이사항(기타사항)'] = row['특이사항'];

    return row;
  });
}

/**
 * 주간 발주체크 기간 자동 계산
 * "차주 수요일 ~ 차차주 화요일"
 */
export function getWeeklyPresetDates(baseDate = new Date()) {
  const current = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const currentDay = current.getDay(); // 0: 일, 1: 월, 2: 화, 3: 수, 4: 목, 5: 금, 6: 토

  const daysUntilNextWed = (3 - currentDay + 7) % 7 + 7;
  const nextWed = new Date(current);
  nextWed.setDate(current.getDate() + (daysUntilNextWed === 7 ? 7 : daysUntilNextWed));

  const afterNextTue = new Date(nextWed);
  afterNextTue.setDate(nextWed.getDate() + 6);

  const format = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return {
    startDate: format(nextWed),
    endDate: format(afterNextTue),
    label: `차주 수요일(${format(nextWed)}) ~ 차차주 화요일(${format(afterNextTue)})`,
  };
}

/**
 * 배송안내 문자 생성 함수
 * 템플릿(customTemplate) 기반 치환
 */
export function generateDeliveryMessage(row, options = {}) {
  const { includeSangwonComment = false, template = null } = options;

  let dateText = row['날짜'] || row['예식일'] || '';
  let formattedDate = dateText;

  const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\s*\(([가-힣])\)/);
  if (dateMatch) {
    formattedDate = `${parseInt(dateMatch[1], 10)}월 ${parseInt(dateMatch[2], 10)}일 (${dateMatch[3]})`;
  } else {
    const isoMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const d = new Date(dateText);
      const dayOfWeek = '일월화수목금토'[d.getDay()] || '';
      formattedDate = `${parseInt(isoMatch[2], 10)}월 ${parseInt(isoMatch[3], 10)}일 (${dayOfWeek})`;
    }
  }

  const bride = cleanBrideName(row['신부명']) || '신부';
  const bouquet = row._cleanedBouquet || cleanBouquetName(row['발주부케']) || row['발주부케'] || '발주부케';
  const shippingTime = (row['배송시간'] || '').trim();
  const shippingPlace = (row['배송지'] || '').trim();

  const deliverySchedule = shippingTime ? `${shippingTime} ${shippingPlace}` : `${shippingPlace}`;

  let sangwonNote = '';
  if (includeSangwonComment && row.sangwonComment) {
    sangwonNote = `\n※ 안내: ${row.sangwonComment}\n`;
  }

  const rawTemplate = template || DEFAULT_CONFIG.smsTemplate;

  return rawTemplate
    .replace(/\{예식일자\}|\{예식월\}월\s*\{예식일\}일\s*\(\{요일\}\)/g, formattedDate)
    .replace(/\{신부명\}/g, bride)
    .replace(/\{발주부케\}/g, bouquet)
    .replace(/\{배송일정\}|\{배송시간\}\{배송지\}/g, deliverySchedule)
    .replace(/\{이상원코멘트\}/g, sangwonNote)
    .trim();
}
