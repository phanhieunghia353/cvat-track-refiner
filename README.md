# CVAT Track Refiner · Experimental 0.2.1

Extension cho Brave / Chrome / Edge: tinh chỉnh **kích thước, tâm và yaw** của cuboid track LiDAR bằng các quan sát nhiều frame. Thuật toán chạy trên máy, có xem trước, backup trước Apply và Undo qua CVAT. Không cần model AI, GPU, Python hay server riêng để sử dụng extension.

**Đây là bản thử thuật toán hình học. Chưa kiểm chứng chất lượng trên job CVAT 2.77.1 thực tế của người dùng.** Các kiểm thử tự động và demo chỉ chứng minh các trường hợp đã kiểm tra, không bảo đảm mọi pre-label đều được cải thiện.

## Bản tải trên GitHub

| Phiên bản                                                                    | Trang release                                                                                             | Trạng thái                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [v0.2.1](https://github.com/phanhieunghia353/cvat-track-refiner/tree/v0.2.1) | [Extension, source và SHA256](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.1) | Bản thử hiện tại; kiểm tra box cuối trên từng frame                 |
| [v0.2.0](https://github.com/phanhieunghia353/cvat-track-refiner/tree/v0.2.0) | [Extension, source và SHA256](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.0) | Lưu lịch sử; có lọc bằng chứng nhưng thiếu kiểm tra lại sau căn tâm |
| [v0.1.0](https://github.com/phanhieunghia353/cvat-track-refiner/tree/v0.1.0) | [Các gói gốc](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.1.0)                 | Lưu lịch sử; còn lỗi bị cụm điểm ngoài kéo lệch box                 |

Cả hai được đánh dấu **prerelease**. Chọn ZIP có chữ `brave` để cài extension; ZIP `source` gồm mã nguồn và tests. Gói tự động “Source code” do GitHub tạo từ tag có cấu trúc repository, khác gói extension đã đóng sẵn.

## Cài đặt

1. Giải nén gói extension vào thư mục ổn định.
2. Mở `brave://extensions` (hoặc `chrome://extensions`, `edge://extensions`), bật Developer mode, chọn Load unpacked.
3. Chọn thư mục `cvat-track-refiner` có `manifest.json` của gói extension. Nếu dùng source repo, chọn `extension/`.
4. Tạm tắt các extension resize trước để thử riêng bản này.
5. Mở tab job CVAT, bấm biểu tượng **CVAT Track Refiner · Experimental**. Extension chạy theo tab đã bấm biểu tượng, không tự đổi theo tab bạn chuyển tới sau đó.

Không phải nhập hostname hoặc token để cài. Quyền `activeTab`, `scripting`, `storage` chỉ cho phép thao tác tab bạn chủ động mở tool. Máy đích cần Chromium 111+; mục tiêu là Ubuntu, Windows và macOS. Các nền tảng này chưa được kiểm thử đầy đủ; Firefox chưa hỗ trợ bởi gói MV3 này.

## Thử không dùng dữ liệu thật

Bấm **Thử dữ liệu mẫu** → **Phân tích**. Mẫu là một vật cứng tổng hợp có box bị nhỏ, lệch tâm và góc, với nhiều mặt nhìn bổ sung. Apply luôn bị khóa trong chế độ mẫu. Màu điểm phân biệt frame, không phải xác suất đúng.

Bấm **Mẫu có cụm điểm ngoài** để thử pre-label gần đúng với nhiễu ở frame 8. Sau phân tích, chọn frame 8 và bật **Hiện điểm bị loại (xám)**: màu xám là điểm không dùng để fit, các màu khác là điểm giữ lại. Đây là phản ví dụ tổng hợp cho lỗi box bị kéo theo cụm ngoài, không phải bản dựng lại scan riêng của người dùng.

## Dùng với CVAT

1. Chọn object trong CVAT, kết thúc thao tác kéo/nhập đang thực hiện; chưa cần Save.
2. Mở tool → **Đọc job / object đang chọn**. Kiểm tra CVAT ID và khoảng frame.
3. Để mặc định 24 frame mẫu hoặc giảm cho job nặng. Chọn khoảng có nhiều góc nhìn và bấm **Phân tích**.
4. Xem đám điểm ghép; chọn từng frame ở danh sách hoặc bấm hàng trong bảng để so Top/Side/Front. Cam là pre-label, xanh là đề xuất.
5. Chọn áp dụng kích thước, tâm/góc, hoặc cả hai. Xem số frame thay đổi và số keyframe thêm.
6. **Apply vào CVAT** thực hiện một native Commit, không reload. Qua frame kiểm tra; Save/Auto save thuộc cơ chế của CVAT.
7. Undo/Redo toàn đợt bằng CVAT. Nút Hoàn tác riêng chỉ chạy khi trạng thái và lịch sử còn đúng sau Apply, để tránh undo nhầm sửa đổi mới.

**Auto save được phép bật.** Sau Apply, CVAT có thể tự lưu trước khi bạn kiểm tra bằng mắt. Nếu muốn kiểm tra trước khi lưu, tắt Auto save trong CVAT; tool không tự đổi cài đặt này.

**Native Commit có thể đổi số # trên sidebar.** Undo/Redo và Save sau đó cũng có thể khiến CVAT cấp lại server ID. Không sử dụng nếu quy trình của bạn phụ thuộc tuyệt đối vào ID không thay đổi.

## Phạm vi bản đầu

- Vật cứng gần thẳng đứng, cuboid track thông thường, 16 giá trị points. Giữ rx/ry ban đầu; từ chối khi chúng vượt ±0,12 rad. Không thiết kế cho người, vật biến dạng hoặc xe khớp nối.
- Tải PCD từ chính server CVAT trong phiên đăng nhập. Đọc ASCII, binary và binary_compressed LZF, tọa độ float32/float64.
- Tối đa 48 frame mẫu, mặc định 24; tối đa 1200 frame trong khoảng Apply. Tối đa 32 MB/file và 2 triệu điểm/frame, giới hạn dữ liệu giải nén 128 MB; chỉ giữ crop đã lấy mẫu trong worker.
- Vùng lấy điểm rộng hơn box, loại mặt đất ngang gần đáy dự kiến và điểm nằm trong box các track khác, rồi lấy thành phần liên thông có hỗ trợ từ pre-label.
- Trước khi fit: đưa điểm về trục pre-label, yêu cầu vùng điểm được ít nhất 3 frame độc lập hỗ trợ trong bán kính 0,22 m. Crop bị đánh dấu không an toàn không có quyền bỏ phiếu. Cụm điểm phải nối với thân box; dải điểm thấp ngoài box không được làm cầu nối sang vật khác.
- Dò yaw cục bộ trên điểm đã lọc; đăng ký từng frame với mẫu từ các frame khác. Ước lượng L/W bằng dải thân giữa, dùng trung vị biên mỗi frame và độ phân tán biên thay cho gộp mọi điểm rồi lấy cực trị. Tính lại kích thước sau vòng chỉnh tư thế cuối. Có giới hạn dịch/xoay và regularization về pre-label.
- Preview ghép chỉ dùng các frame được chấp nhận; hai box giữ chênh lệch tâm/góc thực của frame tham chiếu. Có thể bật điểm bị loại màu xám; bảng hiển thị số điểm giữ/tổng crop.
- Kích thước chỉ đổi ở các chiều đạt kiểm tra bằng chứng. Frame mẫu bị từ chối giữ toàn bộ hình học pre-label, kể cả kích thước; giữa hai mẫu chấp nhận, hiệu chỉnh được nội suy. Không truyền kích thước hoặc tư thế qua một mẫu bị từ chối. Đổi lựa chọn chỉ kích thước/chỉ tư thế cũng phải qua kiểm tra riêng.
- Không tự đổi outside, occluded, class, attribute, nhóm, roll/pitch hoặc padding. Frame outside giữ hình học. Các điểm biên được ghim để hạn chế ảnh hưởng nội suy ngoài khoảng.
- Bản đầu tạo keyframe dày trong khoảng visible để biểu diễn đề xuất chính xác. Chưa có rút gọn keyframe. Với job dài, hãy thử một khoảng nhỏ trước.

## Kết nối và bảo vệ dữ liệu

- Ưu tiên `window.cvatUI.registerComponent`; fallback tìm duy nhất Redux Provider. Đây vẫn là adapter vào CVAT; cùng version không bảo đảm host tùy biến tương thích.
- Đọc cả thay đổi chưa Save bằng `annotations.export()`. Dùng clientID thật của phiên, không đoán từ thứ tự hoặc server ID.
- Không có API ghi trực tiếp, không gọi `annotations.save/import/clear`. GET frame dùng cùng origin và cookie phiên; không gửi dữ liệu cho server trung gian hoặc model ngoài.
- Nếu API nằm dưới reverse-proxy prefix khác, có ô API base, ví dụ `/api` hoặc `/cvat/api`. Không nhận URL ngoài origin.
- Trước Apply, target phải khớp baseline; backup đầy đủ annotation hiện tại được lưu trong `chrome.storage.local`. Lỗi quota → không Apply. Kiểm tra lại toàn snapshot ngay trước Commit.
- Sau Commit so sánh chính xác toàn annotation ngoài target, cùng nội dung target dự kiến (không tính serialization IDs). Nếu audit/refresh lỗi sau Commit, báo **đã Apply kèm cảnh báo**, không tự thử lại hoặc rollback cả job.
- Backup có thể chứa nhãn chưa Save; có thể tải JSON riêng. Chỉ giữ snapshot mới nhất của mỗi job. Snapshot không phải gói dataset CVAT và chưa có chức năng nhập để khôi phục cả job bằng một nút.
- Không đưa backup hoặc báo cáo job riêng tư vào Git public. Mã nguồn và demo không chứa annotation/point cloud thật.

## Báo cáo và tái chạy lỗi

**Tải báo cáo phân tích** chứa thông số, quyết định giữ box và kết quả kiểm tra cuối từng frame. Bản báo cáo thông thường không có tọa độ điểm nên không đủ để tái chạy bộ fit.

**Tải chẩn đoán có điểm crop** là lựa chọn riêng chứa các crop giới hạn đang nằm trong bộ nhớ, không chứa toàn bộ PCD hoặc cookie/token. File chỉ tải về máy, không tự gửi tới GitHub hay nơi khác. Tọa độ vẫn là dữ liệu của job: không commit file này vào repo Public. Có thể tái chạy cục bộ bằng:

```sh
node scripts/replay.mjs /path/to/track-refiner-crop-diagnostic.json > replay-report.json
```

v0.2.1 kiểm tra box sau mọi bước căn tâm: giới hạn phần điểm trước đó nằm trong pre-label nhưng bị box mới bỏ ra ngoài, có dung sai 8 cm và ngưỡng mất tối đa 4% (tối thiểu 3 điểm). Đồng thời kiểm tra lại khớp mẫu không chứa chính frame đó; nếu tâm cuối không đạt, thử tư thế trước căn tâm hoặc giữ nguyên pre-label. Các ngưỡng này là heuristic. Điểm bị lọc nhầm vẫn có thể làm kiểm tra đánh giá sai; frame chưa lấy mẫu chưa được kiểm tra bằng point cloud riêng.

## Giới hạn về chất lượng

Không thể suy ra chắc chắn mặt chưa từng được quan sát. Box bị lệch xa ngoài vùng tìm, sai ID tracking, vật chạm nhau, mặt đường dốc, scan bị méo chuyển động, điểm quá thưa hoặc nhiều outlier vẫn có thể cho kết quả sai. Component có thể dính vật bên cạnh; kiểm tra cảnh cạnh tranh là heuristic, không phải semantic segmentation.

Lọc theo thời gian dựa vào trục pre-label gần đúng: pose sai nhiều, bề mặt chỉ thấy một lần hoặc chuyển động quét có thể làm mất điểm thật. Nhiễu lặp lại và chạm thân xe vẫn có thể qua bộ lọc. Đây chưa phải ray tracing để xác nhận vùng trống, model hình dạng hay hệ thống loại ghosting hoàn chỉnh. Không nới box chỉ vì một frame có điểm ngoài; ngược lại, phần thân thật ngoài box nhỏ vẫn có thể được giữ nếu có bằng chứng lặp lại và kết nối phù hợp.

Yaw search giữ gần pre-label và không tự phân biệt đầu/đuôi 180°. Mẫu từ nhiều frame giảm thiếu góc nhìn nhưng không biến bài toán không đủ bằng chứng thành đo đạc chắc chắn. Chỉ báo “có hỗ trợ” là kiểm tra khớp hình học, chưa được hiệu chuẩn thành độ chính xác. Không coi việc tăng số điểm hoặc giảm residual là chứng minh box đúng.

Hiện hỗ trợ job có frame liên tiếp; tool kiểm tra metadata và chặn frame filter/step khác 1 để tránh ghép nhầm số frame. Các format frame trả ZIP/ảnh thay PCD chưa hỗ trợ. Thông báo lỗi phải được xử lý, không có fallback ghi server.

## Dành cho người phát triển

Mã ES modules, Canvas2D và Web Worker; không có runtime dependencies hoặc CDN. Comment tiếng Anh, giao diện và hướng dẫn tiếng Việt. Đơn vị và các giả định nằm trong JSDoc. Xem [DESIGN.md](DESIGN.md) và [VALIDATION.md](VALIDATION.md).

```text
extension/cvat/           Adapter, native Commit và ranh giới backup
extension/core/           Hệ tọa độ, nội suy, cấu hình và tạo draft
extension/pointcloud/     PCD/LZF, crop và lấy mẫu
extension/fitting/        Bộ tinh chỉnh hình học thuần
extension/workers/        Luồng tính toán; chỉ giữ crop giới hạn
extension/ui/             Vẽ box/điểm; không sửa annotation
extension/demo/           Dữ liệu tổng hợp có ground truth
tests/                   Tests Node, mock CVAT và worker thật
scripts/                 Test runner và đóng gói
```

Node.js 20+ để chạy test. Python 3 chỉ dùng khi đóng gói/chạy demo HTTP, không cần trên máy người dùng extension:

```sh
node scripts/test.mjs
python3 scripts/build.py
```

Để kiểm tra UI ngoài extension:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory extension
```

Mở `http://127.0.0.1:8765/panel.html` → Thử dữ liệu mẫu. Ngoài extension, nút đọc/Apply CVAT không hoạt động. Có thể chạy format tùy chọn bằng `npx prettier@3.6.2 --write extension tests`; không cần formatter để sử dụng hoặc chạy tests.

## Nguồn và giấy phép

MIT. Cơ chế native Commit, frame refresh và hỗ trợ PCD được tham khảo/điều chỉnh từ [prelabelcheck_CVAT](https://github.com/thanhdanh11-test/prelabelcheck_CVAT), commit `0c6246c03704c142c27cddf9df4b9be2f3d7522b`. Giữ thông báo bản quyền của tác giả trong `THIRD-PARTY-LICENSES.txt` và `NOTICE.md`.

Ý tưởng refinement theo object qua nhiều frame được đối chiếu với [Auto4D](https://arxiv.org/abs/2101.06586) và [3DAL](https://openaccess.thecvf.com/content/CVPR2021/html/Qi_Offboard_3D_Object_Detection_From_Point_Cloud_Sequences_CVPR_2021_paper.html). **Bản này không triển khai các model học sâu đó, không sử dụng weights hoặc hứa chất lượng tương đương các bài báo.**

## GitHub version archive

Original v0.1.0 and v0.2.0 ZIPs are preserved under `release-assets/`; each source version has a Git tag. See `releases/index.json` for exact source commits. Commits were imported when preparing this repository, not backdated development history. `dist/` is reserved for newly built packages.
