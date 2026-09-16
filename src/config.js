/**
 * 발주체크 세부 변환 설정 및 사용자 커스텀 규칙 관리 (config.js)
 */

export const DEFAULT_CONFIG = {
  // 1. 합산 및 처리 옵션
  enableAggregation: true,
  enableOutTime: true,
  enableNeedsCheckTag: true,

  // 2. 부케 표기 변환 규칙 (위에서부터 순차 매칭)
  bouquetRules: [
    { pattern: 'VS플러스', replacement: 'VS+' },
    { pattern: 'VS+', replacement: 'VS+' },
    { pattern: 'VVS', replacement: 'VVS' },
    { pattern: 'BL-', replacement: '$CODE' }, // $CODE: BL-15 같은 코드 유지
    { pattern: 'S-', replacement: '$CODE' },  // $CODE: S-303 같은 코드 유지
    { pattern: '서비스 촬영부케', replacement: '촬영 부케' },
    { pattern: '촬영부케', replacement: '촬영 부케' },
    { pattern: '서비스 본식부케', replacement: 'S' },
  ],

  // 3. 배송안내 문자 공통 템플릿
  smsTemplate: `【OZIC BLOSSOM 배송안내】
{예식일자} {신부명}신부님
{발주부케}
{배송일정} 배송예정입니다.{이상원코멘트}

▶위의 내용 꼭 확인해주시고, 변경사항 있으시면 수요일이전에 알려주세요!
▶예식주 안나오는 잔소재는 대체될 수 있는 점 참고 부탁드리며,
▶부케명이 잘못 표기되어 있는 경우 당일 변경어렵거나 추가금이 발생될 수 있으며,
▶배송지 잘못 기재되어 예식당일 급하게 변경시 1만원의 배송추가금이 발생될 수 있습니다.
▶배송안내문자는 월~화요일 사이에 발송됩니다. 화요일까지 문자 못 받으신 경우 누락될 수 있으니 꼭 확인연락주시고, 화요일 이후 늦게 발주 보내주신 건은 따로 문자발송하지 않으니 양해부탁드립니다.
▶메이크업샵에서 부케확인하실 때 박스 안에 부토니에, 코사지 6개 사이드에 붙어있는지 꼭 확인바랍니다.
메이크업샵에서 아웃하고 난 후 연락주시면 대처가 어려우니 꼭 확인바랍니다.`,
};

const STORAGE_KEY = 'ozic_balju_custom_config_v1';

/**
 * 로컬 저장소에서 설정을 불러옵니다 (없으면 기본값)
 */
export function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        bouquetRules: Array.isArray(parsed.bouquetRules) ? parsed.bouquetRules : DEFAULT_CONFIG.bouquetRules,
      };
    }
  } catch (err) {
    console.warn('설정 불러오기 실패, 기본값 사용:', err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * 설정을 로컬 저장소에 저장합니다
 */
export function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('설정 저장 실패:', err);
  }
}

/**
 * 설정을 기본값으로 초기화합니다
 */
export function resetConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('설정 초기화 실패:', err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
