# Định hướng: lõi dựng hình vật thể qua nhiều frame

Trạng thái: **v0.3.0 triển khai mốc đầu**: crop giữ mask, pháp tuyến từ covariance, căn point-to-plane có kiểm tra rank/đồ thị về mốc, kiểm tra tập điểm giữ lại, hợp nhất ô bề mặt có nguồn frame, viewer 3D và box chung chỉnh tay qua ô số. Không phải tuyên bố đã dựng được đầy đủ bề mặt xe từ dữ liệu hiện có.

Chưa có phân loại thân xe/gương tự động, global pose graph đầy đủ, shape completion, multi-hypothesis association hay kéo tay nắm box trong 3D. Các đoạn dưới là thiết kế đích; xem [CORE-USER-GUIDE.md](CORE-USER-GUIDE.md) và [DESIGN.md](DESIGN.md) để biết hành vi thực tế.

## Mục tiêu sản phẩm

Lõi tạo ra một biểu diễn vật thể chung có thể kiểm tra, các phép biến đổi về từng frame và mức độ bằng chứng. Box tự động, box từ model và box do người dùng chỉnh trên vật thể chung đều sử dụng cùng lõi này.

Ưu tiên tiếp theo là chất lượng căn ghép/bề mặt, khả năng truy nguồn và chỉnh sửa. Các kiểm tra an toàn của v0.2.1 vẫn cần giữ, nhưng không dùng số box được chấp nhận làm chỉ số chất lượng dựng hình.

## Dữ liệu lõi độc lập với box

```ts
interface Reconstruction {
  reference: { frame: number; convention: "object-to-frame"; units: "metres" };
  observations: Observation[]; // Bounded crops with source IDs and soft masks.
  poses: FramePose[]; // Canonical object -> each native frame.
  surfaces: SurfaceElement[]; // Observed geometry, normals and provenance.
  diagnostics: ReconstructionDiagnostics;
}
```

- Observation giữ frame ID, điểm crop, chất lượng crop và nguồn điểm. Không coi pre-label là phép cắt chính xác của thân xe.
- FramePose chứa phép biến đổi, trạng thái chấp nhận/không xác định, hỗ trợ hình học và các hướng dịch/xoay còn mơ hồ.
- SurfaceElement giữ vị trí, pháp tuyến khi ước lượng được, các frame đóng góp, độ phân tán và vai trò `body / accessory / background / unknown`. Vai trò có thể do thuật toán, model hoặc người dùng cung cấp; không giả định chỉ cần ghép là tự biết gương.
- Phân biệt bề mặt quan sát được với phần suy đoán/hoàn thiện bằng prior hoặc model. Không tự tạo mặt ở vùng trống rồi trình bày như dữ liệu đo.
- Giữ gauge cố định tại một frame/tham chiếu để các vòng tối ưu không cùng trôi hệ tọa độ. Nếu đổi hệ tham chiếu, phải biến đổi cả bề mặt, pose và box chỉnh tay.
- Hợp đồng xuất kết quả phải có phiên bản; module box không được phụ thuộc cấu trúc Redux/CVAT.

## Luồng xử lý đích

1. **Thu thập bằng chứng:** tải PCD qua adapter hiện có, lấy crop rộng có giới hạn, giữ nguồn frame và mask. Những điểm ít lặp lại là bằng chứng yếu, không tự động là nhiễu: có thể đó là mặt xe chỉ thấy một lần.
2. **Khởi tạo tư thế:** dùng pre-label làm gợi ý tâm/góc, không dùng biên box để định nghĩa hình dạng xe. Khóa tham chiếu và giữ giả thuyết hướng ban đầu khi chưa phân biệt được đầu/đuôi.
3. **Căn ghép theo vùng bề mặt tương ứng:** ước lượng đặc trưng/pháp tuyến khi đủ điểm; ghép các vùng có chồng lấp, hạn chế mặt phẳng đơn kéo trượt theo phương không quan sát được. Giữ nhiều giả thuyết hoặc từ chối khi không xác định được.
4. **Tối ưu chung:** cập nhật tư thế và biểu diễn bề mặt luân phiên trên toàn tập, với trọng số theo frame/vùng quan sát. Một frame nhiều điểm không được tự áp đảo phần còn lại. Không căn mỗi frame về trung điểm hai mép crop.
5. **Hợp nhất có truy nguồn:** giữ bề mặt nhất quán, độ dày/phân tán và các quan sát xung đột. Nhiễu lặp lại hoặc gương thật vẫn cần phân loại/loại trừ theo mục tiêu, không thể chỉ dựa vào số phiếu theo thời gian.
6. **Đánh giá độc lập:** kiểm tra trên frame/vùng không dùng để fit, hiển thị residual, ghosting và các bậc tự do chưa xác định. Ảnh ghép nhìn sắc hoặc loss nhỏ không đủ chứng minh hình dạng/tư thế đúng.

Nếu hai nhóm quan sát không có bề mặt chồng lấp, không được hứa ghép chính xác bằng khớp điểm đơn thuần. Pre-label, ràng buộc hình dạng hoặc anchor thủ công có thể hỗ trợ; phải ghi rõ phần phụ thuộc các giả định đó.

Không suy ra vận tốc thế giới từ tọa độ tương đối với cảm biến khi thiếu ego-motion. Chỉ thực hiện kiểm tra tia nhìn/vùng trống khi có đủ thông tin gốc tia và quy ước tọa độ; không đoán từ việc một vùng không có điểm.

## Hai đầu ra dùng chung lõi

### Người dùng chỉnh box trên vật thể chung

Người dùng xem hình ghép 3D và các lát cắt, bật/tắt frame, đánh dấu điểm/cụm không thuộc mục tiêu, ghim frame đáng tin cậy và chỉnh một box trong hệ vật thể chung.

Nếu `T_f` đưa hệ vật thể chung về frame `f`, còn `B_common` là pose của box trong hệ chung:

```text
B_f = T_f × B_common
```

`T_f` là biến đổi rigid, không chứa scale. Kích thước box dùng chung; tâm/góc được biến đổi riêng theo từng frame. Đúng kích thước chưa bảo đảm đúng vị trí nếu `T_f` sai.

Phép ghép ma trận phải tôn trọng quy ước XYZ của CVAT. Adapter v0.2.1 đang giới hạn vật gần thẳng đứng và chỉ chỉnh yaw; phiên bản editor đầu tiên phải tuân thủ giới hạn này hoặc mở rộng adapter có kiểm chứng riêng. Không cộng tùy ý các góc Euler.

Mỗi frame chưa xác định được pose phải hiện riêng, cho phép chỉnh/ghim hoặc loại khỏi Apply. Nếu chỉ căn ghép một phần frame, các frame còn lại phải được đánh dấu nội suy/chưa xác minh; không gọi là đã tái dựng toàn track.

### Thuật toán hoặc model đề xuất box

Box proposer là module riêng, nhận bề mặt cùng bằng chứng/quan sát, trả về box trong hệ chung và lý do/độ bất định. Có thể thay bộ hình học bằng model mà không thay adapter, viewer hay thao tác Apply.

Phải định nghĩa rõ đối tượng cần bao: thân xe có/không gương, bánh, phụ kiện. Model có thể bổ sung prior cho phần khuất; phần này phải phân biệt với bề mặt thật đã đo. Core vẫn hoạt động khi không có model hoặc không đủ phần cứng.

## Phần hiện tại được tái sử dụng

- Extension MV3, tab binding, adapter CVAT, đọc annotation chưa Save, PCD/LZF parser.
- Web Worker, giới hạn bộ nhớ, hủy tác vụ, export chẩn đoán và script replay.
- Preview từng frame, tạo draft, backup trước Apply, native Commit/Undo và audit các object khác.

`filterEvidence()` và `estimateDimensions()` hiện tại là baseline heuristic, không phải lõi dựng hình mới. Đặc biệt không tái dùng cứng việc xóa điểm theo số frame trước khi có căn ghép tin cậy, hoặc dùng biên từng crop làm tâm xe.

## Thứ tự triển khai và điều kiện nghiệm thu

1. Tách gói quan sát, hệ tham chiếu và phép biến đổi khỏi `refineTrack()`; kết quả dựng hình không bắt buộc phải có box.
2. Dựng viewer 3D/lát cắt và công cụ so khớp từng frame, truy nguồn điểm, bật/tắt quan sát, giữ snapshot tái chạy được.
3. Phát triển căn ghép/bề mặt bằng các ca thật: lệch pre-label, quan sát một bên, gương nhô, mép nóc, đầu/đuôi không chồng lấp, vật cạnh xe và occlusion. Dữ liệu riêng chỉ đọc cục bộ; test public dùng dữ liệu tổng hợp hoặc dữ liệu được phép phát hành.
4. Cho chỉnh box chung và chiếu về từng frame. Kiểm chứng biến đổi bằng round-trip, overlay, anchor và kiểm tra phạm vi Apply/Undo.
5. Thêm box proposer hình học/model sau khi lõi có kết quả đo được trên dữ liệu giữ lại để đánh giá.

Đánh giá gồm sai số tư thế khi có tham chiếu, độ phân tán theo pháp tuyến của bề mặt, độ nhất quán trên frame giữ lại, tỷ lệ vùng chưa xác định, lỗi thân xe/phụ kiện và mức chỉnh tay cần thiết. Không dùng riêng tỷ lệ điểm nằm trong box hay độ đẹp của ảnh ghép làm tiêu chí.

Các ngưỡng nghiệm thu định lượng phải được chọn từ dữ liệu/độ chính xác yêu cầu của job, không tự công bố từ test cuboid sạch. Chưa có benchmark thật thì không tuyên bố đạt độ chính xác thực tế.

Tất cả đầu ra tiếp tục là preview cục bộ. Chỉ Apply khi người dùng bấm; không thêm reload hay tự ghi annotation qua REST. Save/Auto save sau Apply vẫn thuộc CVAT.
