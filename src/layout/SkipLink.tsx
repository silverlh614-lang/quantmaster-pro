/**
 * SkipLink — 스크린리더 / 키보드 사용자용 "본문 바로가기" 링크.
 *
 * 탭 키로 첫 포커스를 받으면 화면 좌상단에 나타나고, Enter 시 #main-content
 * 으로 점프. 시각적으로 방해하지 않도록 focus 전에는 sr-only 로 숨긴다.
 */
import React from 'react';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-lg focus:bg-blue-500 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white focus:shadow-xl"
    >
      본문으로 바로가기
    </a>
  );
}
