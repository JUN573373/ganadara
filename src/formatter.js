/**
 * 발주 데이터 정제 및 변환 모듈 (formatter.js)
 */

/**
 * 부케 상품명에서 등급/코드 추출
 * 예: "[본식9/1-] VS플러스 -5" -> "VS+"
 *     "[본식 9/1-] BL-15" -> "BL-15"
 *     "Vs+512 화이트장미그린" -> "VS+512"
 *     "S-303화이트장미보리사초" -> "S-303"
 */
export function cleanBouquetName(rawName) {
  if (!rawName) return '';
  let str = String(rawName).replace('수임료차감포함', '').trim();

  // 금액만 있는 경우 (예: "10만원 - 100,000원", "[본식추가] 10만원")
  const priceMatch = str.match(/(\d+만원)/);

  // 1. BL 계열 (BL-15, BL-1228, BL-1246 등)
  const blMatch = str.match(/\b(BL-?\d+)\b/i);
  if (blMatch) {
    const code = blMatch[1].toUpperCase();
    return code.startsWith('BL-') ? code : code.replace('BL', 'BL-');
  }

  // 2. VS+ / VS플러스 계열 (VS+512, VS+573, VS+ 등)
  if (/VS\s*플러스/i.test(str) || /VS\+/i.test(str)) {
    const numMatch = str.match(/VS(?:\+|플러스)\s*(\d+)/i);
    if (numMatch && numMatch[1]) {
      return `VS+${numMatch[1]}`;
    }
    return 'VS+';
  }

  // 3. VVS 계열 (VVS-6, VVS 15만원 등)
  const vvsMatch = str.match(/\b(VVS(?:-\d+)?)\b/i);
  if (vvsMatch) {
    return vvsMatch[1].toUpperCase();
  }

  // 4. VS 단독 계열
  const vsMatch = str.match(/\b(VS(?:-\d+)?)\b/i);
  if (vsMatch && !/VS(?:\+|플러스)/i.test(str)) {
    return vsMatch[1].toUpperCase();
  }

  // 5. S-코드 계열 (S-303, S-313, S-302 등)
  const sCodeMatch = str.match(/\b(S-\d+)\b/i);
  if (sCodeMatch) {
    return sCodeMatch[1].toUpperCase();
  }

  // 6. S 단독 등급 (예: "[서비스 본식부케] S", "[촬영부케] S 10만원")
  if (/\bS\b/i.test(str) || /\]\s*S\b/i.test(str)) {
    return 'S';
  }

  // 7. 만약 특별한 등급 없이 금액이 있는 경우 (예: "10만원", "8만원")
  if (priceMatch) {
    if (str.includes('추가')) return `[추가] ${priceMatch[1]}`;
    return priceMatch[1];
  }

  // 8. 괄호 제거 후 앞부분 정리
  const clean = str.replace(/^\[[^\]]+\]\s*/, '').split('-')[0].trim();
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
      // 앞뒤에 남은 슬래시, 대시, 쉼표, 공백 제거
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
  // 통상 신부명이 첫 번째에 위치
  return parts[0] || name;
}

/**
 * 주문 합산 함수
 * 기준: 기관(site) + 예식일(날짜) + 플래너 + 신부명
 */
export function aggregateOrders(rawList, siteKey = 'ini') {
  const groups = new Map();

  for (const item of rawList) {
    const planner = (item['담당플래너'] || '').trim();
    const bride = cleanBrideName(item['신부명']);
    const date = (item['날짜'] || item['예식일'] || '').trim();

    const key = `${siteKey}_${date}_${planner}_${bride}`;

    if (!groups.has(key)) {
      groups.set(key, {
        ...item,
        _site: siteKey,
        _key: key,
        _isAggregated: false,
        _originalOrders: [item],
        // 사용자 코멘트 기본값
        myComment: item.myComment || '',
        sangwonComment: item.sangwonComment || '',
      });
    } else {
      const existing = groups.get(key);
      existing._isAggregated = true;
      existing._originalOrders.push(item);

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

      // 빈 필드 채우기 (배송지, 예식장소 등)
      if (!existing['배송지'] && item['배송지']) existing['배송지'] = item['배송지'];
      if (!existing['예식장소'] && item['예식장소']) existing['예식장소'] = item['예식장소'];
      if (!existing['예식시간'] && item['예식시간']) existing['예식시간'] = item['예식시간'];
    }
  }

  return Array.from(groups.values()).map((row, idx) => {
    // 부케명 단정하게 정제된 표시용 필드
    row._cleanedBouquet = cleanBouquetName(row['발주부케']);
    // 특이사항 정제 (아웃시간 앞단 배치)
    const rawNote = row['특이사항(기타사항)'] || row['특이사항'] || '';
    row['특이사항'] = formatNotes(rawNote, row['예식시간']);
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

  // 다음 주 수요일까지 필요한 일수 계산
  // 이번 주 수요일(3)로부터 7일 뒤가 다음 주 수요일
  const daysUntilNextWed = (3 - currentDay + 7) % 7 + 7;
  const nextWed = new Date(current);
  nextWed.setDate(current.getDate() + (daysUntilNextWed === 7 ? 7 : daysUntilNextWed));

  // 그 다음 주 화요일은 다음 주 수요일로부터 6일 뒤
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
 * 「OZIC BLOSSOM 배송안내」 표준 서식
 */
export function generateDeliveryMessage(row, options = {}) {
  const { includeSangwonComment = false } = options;

  // 날짜/요일 파싱 (예: "09/12(토)" 또는 "2026-09-12")
  let dateText = row['날짜'] || row['예식일'] || '';
  let month = '';
  let day = '';
  let dayOfWeek = '';

  const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\s*\(([가-힣])\)/);
  if (dateMatch) {
    month = parseInt(dateMatch[1], 10);
    day = parseInt(dateMatch[2], 10);
    dayOfWeek = dateMatch[3];
  } else {
    const isoMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const d = new Date(dateText);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
      dayOfWeek = '일월화수목금토'[d.getDay()] || '';
    }
  }

  const bride = cleanBrideName(row['신부명']) || '신부';
  const bouquet = row._cleanedBouquet || cleanBouquetName(row['발주부케']) || row['발주부케'] || '발주부케';
  const shippingTime = (row['배송시간'] || '').trim();
  const shippingPlace = (row['배송지'] || '').replace(/\(확인필요\)/g, '').trim();

  const deliverySchedule = shippingTime ? `${shippingTime} ${shippingPlace}` : `${shippingPlace}`;

  let sangwonNote = '';
  if (includeSangwonComment && row.sangwonComment) {
    sangwonNote = `\n※ 안내: ${row.sangwonComment}\n`;
  }

  return `【OZIC BLOSSOM 배송안내】
${month ? `${month}월 ${day}일 (${dayOfWeek})` : dateText} ${bride}신부님
${bouquet}
${deliverySchedule} 배송예정입니다.${sangwonNote}

▶위의 내용 꼭 확인해주시고, 변경사항 있으시면 수요일이전에 알려주세요!
▶예식주 안나오는 잔소재는 대체될 수 있는 점 참고 부탁드리며,
▶부케명이 잘못 표기되어 있는 경우 당일 변경어렵거나 추가금이 발생될 수 있으며,
▶배송지 잘못 기재되어 예식당일 급하게 변경시 1만원의 배송추가금이 발생될 수 있습니다.
▶배송안내문자는 월~화요일 사이에 발송됩니다. 화요일까지 문자 못 받으신 경우 누락될 수 있으니 꼭 확인연락주시고, 화요일 이후 늦게 발주 보내주신 건은 따로 문자발송하지 않으니 양해부탁드립니다.
▶메이크업샵에서 부케확인하실 때 박스 안에 부토니에, 코사지 6개 사이드에 붙어있는지 꼭 확인바랍니다.
메이크업샵에서 아웃하고 난 후 연락주시면 대처가 어려우니 꼭 확인바랍니다.`.trim();
}
