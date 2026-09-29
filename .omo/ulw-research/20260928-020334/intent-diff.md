| intent_id | expected truth | observed reality | diff | violated invariant | intent source | observations | status | claims |
|---|---|---|---|---|---|---|---|---|
| I1 | 데이터 규모가 늘어도 현재 설계가 버틴다 | 166k행에서 enrich 17.8분, 백필 46분 미종료 | 처리량 스케일링 | 성장에 선형/초선형 비용 | 사용자 의도(전량 저장) | O2,O3 | violated | C-SCALING |
| I2 | 운영자가 저장 완료를 확인할 수 있다 | enrich만 진행 로그, 백필 종료 판정 없음 | 관측성 공백 | 진행 가시성 | 운영 가능성 | O3 | violated | C-OBSERVABILITY |
| I3 | Discord API 한도를 존중한다 | 미확인 | 확인 필요 | rate limit 준수 | Discord 정책 | - | unknown | C-RATELIMIT |
| I4 | 웹 대시보드가 안전하게 노출된다 | 0.0.0.0 + 무인증 | 노출 | 보안 | README 자체 경고 | S1 | violated | C-SECURITY |
| I5 | 저장 데이터가 커져도 조회가 빠르다 | 미확인 | 확인 필요 | 쿼리 성능 | 성장 | S2 | unknown | C-QUERY |
