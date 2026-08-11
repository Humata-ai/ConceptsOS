import { Button } from "../../utils/button/Button.jsx";
import styles from "./Settings.module.css";
import utilStyles from "../../../styles/utils.module.css";

export function AboutSettings() {
	return (<>
		<div className={styles["Option"]}>
			<p className={styles["Label"]}>About ConceptsOS</p>
			<p className={utilStyles["Text-light"]}>ConceptsOS is a web-based desktop that ships with an embedded AI Agent. The desktop shell is derived from the open-source ProzillaOS project (MIT).</p>
			<div className={styles["Button-group"]}>
				<Button
					className={`${styles.Button} ${utilStyles["Text-bold"]}`}
					href="https://github.com/Humata-ai/ConceptsOS"
				>
					View source
				</Button>
			</div>
		</div>
	</>);
}
